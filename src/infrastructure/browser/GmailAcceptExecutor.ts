import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "playwright";
import type { GmailInvitationAccepter, GmailAcceptOutcome } from "../../domain/repositories/GmailInvitationAccepter.js";
import type { GmailSession } from "../../domain/repositories/GmailInvitationSearcher.js";
import type { GmailInvitationCandidate } from "../../domain/entities/GmailInvitation.js";
import {
  classifyAcceptPage,
  extractCampaignsUrlFromAcceptPageUrl,
} from "../../domain/services/gmailAcceptResultClassifier.js";
import { logger } from "../logger/logger.js";

interface InternalSession {
  browser: Browser;
  page: Page;
}

const SIGN_IN_SELECTORS = [
  '[data-identifier]',
  'input[type="email"]',
  '[aria-label*="Sign in"]',
  'form[action*="accounts.google"]',
];

const CONFIRM_BUTTON_NAMES = /accept invitation|accept|continue|confirm/i;

// Selectors that confirm the campaigns table is visible and loaded.
const CAMPAIGNS_TABLE_SELECTORS = [
  '[role="grid"][aria-label*="ampaign"]',
  'table[aria-label*="ampaign"]',
  '[data-campaign-table]',
  // Generic Google Ads data table that appears on the campaigns list
  '.KF4T6b',
  '[role="grid"]',
];

// Selectors for the Campaigns nav item in the Google Ads left navigation.
const CAMPAIGNS_NAV_SELECTORS = [
  'a[href*="/aw/campaigns"]',
  '[role="treeitem"] a',
  'nav a',
];

const CAMPAIGNS_URL_PATTERN = /\/aw\/campaigns/;

const CAMPAIGNS_NAV_RETRY_LIMIT = 3;

export class GmailAcceptExecutor implements GmailInvitationAccepter {
  constructor(
    private readonly acceptTimeoutMs: number,
    private readonly screenshotDir: string,
    private readonly acceptPageTimeoutMs: number = 90000,
    private readonly acceptSettleDelayMs: number = 3000,
    private readonly campaignsPageTimeoutMs: number = 120000,
    private readonly campaignsSettleDelayMs: number = 5000,
  ) {}

  async accept(session: GmailSession, candidate: GmailInvitationCandidate): Promise<GmailAcceptOutcome> {
    const { browser, page: gmailPage } = session as InternalSession;

    const acceptUrl = candidate.acceptUrl ?? null;
    if (!acceptUrl) {
      const screenshotPath = await this.screenshot(gmailPage, "no_accept_url");
      logger.warn("GmailAcceptExecutor: no acceptUrl on candidate");
      return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
    }

    // Open the accept URL in a new tab — never navigate the Gmail tab away from Gmail.
    const context = browser.contexts()[0];
    if (!context) {
      return { kind: "FAILED", reason: "No browser context available", screenshotPath: null };
    }

    let acceptPage: Page | null = null;
    try {
      acceptPage = await context.newPage();
      await acceptPage.goto(acceptUrl, { waitUntil: "domcontentloaded", timeout: this.acceptPageTimeoutMs });

      const ready = await this.waitForAcceptPageReady(acceptPage);
      if (!ready) {
        logger.warn({ acceptUrl }, "GmailAcceptExecutor: accept page not ready within timeout");
        await this.screenshot(acceptPage, "not_ready").catch(() => null);
        return { kind: "ACCEPT_PAGE_NOT_READY_TIMEOUT" };
      }

      const normalizedCustomerId = candidate.body.match(/\d{3}-\d{3}-\d{4}/)?.at(0) ?? "";
      const outcome = await this.classifyAndAct(acceptPage, acceptUrl, normalizedCustomerId);

      // After a successful accept, open the campaigns page in a new tab and wait for it.
      if (outcome.kind === "ACCEPTED" || outcome.kind === "ALREADY_ACCEPTED") {
        const campaignsUrl =
          outcome.campaignsUrl ?? extractCampaignsUrlFromAcceptPageUrl(acceptPage.url(), normalizedCustomerId);

        const campaignsResult = await this.openAndWaitForCampaignsPage(context, campaignsUrl);

        if (!campaignsResult.ready) {
          logger.warn({ campaignsUrl }, "GmailAcceptExecutor: campaigns page not ready after accept");
          return {
            kind: "MANUAL_ACTION_REQUIRED",
            reason: "CAMPAIGNS_PAGE_NOT_READY",
            screenshotPath: campaignsResult.screenshotPath,
          };
        }

        if (outcome.kind === "ACCEPTED") {
          return { ...outcome, campaignsUrl, campaignsPageReady: true };
        }
        return { ...outcome, campaignsUrl, campaignsPageReady: true };
      }

      return outcome;
    } catch (error) {
      logger.error({ err: error }, "GmailAcceptExecutor: unexpected error");
      const screenshotPath = await this.screenshot(acceptPage ?? gmailPage, "error").catch(() => null);
      return { kind: "FAILED", reason: String(error), screenshotPath };
    }
  }

  // ---------------------------------------------------------------------------
  // Accept page helpers
  // ---------------------------------------------------------------------------

  /**
   * Waits for the accept page body to be non-empty and showing a classifiable state.
   * Returns false on timeout.
   */
  private async waitForAcceptPageReady(page: Page): Promise<boolean> {
    const deadline = Date.now() + this.acceptPageTimeoutMs;
    const pollMs = 1500;

    while (Date.now() < deadline) {
      const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
      if (bodyText.trim().length > 50) {
        await page.waitForTimeout(this.acceptSettleDelayMs);
        return true;
      }
      await page.waitForTimeout(pollMs);
    }

    return false;
  }

  private async classifyAndAct(
    page: Page,
    acceptUrl: string,
    normalizedCustomerId: string,
  ): Promise<GmailAcceptOutcome> {
    const pageText = (await page.textContent("body").catch(() => "")) ?? "";
    const pageUrl = page.url();

    const confirmBtn = await this.findConfirmButton(page);
    const hasConfirmButton = confirmBtn !== null;
    const hasSignInIndicator = await this.hasSignInForm(page);

    const classification = classifyAcceptPage(pageText, hasConfirmButton, hasSignInIndicator);

    logger.info(
      {
        classification,
        pageUrl,
        pageTextPreview: pageText.slice(0, 200).trim(),
        hasConfirmButton,
        hasSignInIndicator,
      },
      "GmailAcceptExecutor: result page classification",
    );

    switch (classification) {
      case "ALREADY_ACCEPTED": {
        const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(pageUrl, normalizedCustomerId);
        const screenshotPath = await this.screenshot(page, "already_accepted");
        logger.info({ campaignsUrl, pageUrl }, "GmailAcceptExecutor: invitation already accepted");
        return { kind: "ALREADY_ACCEPTED", campaignsUrl, screenshotPath, campaignsPageReady: false };
      }

      case "SUCCESS": {
        const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(pageUrl, normalizedCustomerId);
        return { kind: "ACCEPTED", acceptUrl, campaignsUrl, campaignsPageReady: false };
      }

      case "EXPIRED_OR_CANCELLED": {
        const screenshotPath = await this.screenshot(page, "expired");
        return { kind: "FAILED", reason: "INVITATION_EXPIRED_OR_CANCELLED", screenshotPath };
      }

      case "SIGN_IN_REQUIRED": {
        logger.warn({ pageUrl }, "GmailAcceptExecutor: sign-in required on accept page");
        return { kind: "SIGN_IN_REQUIRED" };
      }

      case "NEEDS_CONFIRM": {
        const btnText = await confirmBtn!.textContent().catch(() => "");
        logger.info({ btnText: btnText?.trim(), pageUrl }, "GmailAcceptExecutor: CONTINUE_CLICKED");
        await confirmBtn!.click();
        await page.waitForLoadState("domcontentloaded", { timeout: this.acceptPageTimeoutMs }).catch(() => undefined);

        const ready = await this.waitForAcceptPageReady(page);
        if (!ready) {
          return { kind: "ACCEPT_PAGE_NOT_READY_TIMEOUT" };
        }

        const postText = (await page.textContent("body").catch(() => "")) ?? "";
        const postUrl = page.url();
        const postHasSignIn = await this.hasSignInForm(page);
        const postClassification = classifyAcceptPage(postText, false, postHasSignIn);

        if (postClassification === "SUCCESS") {
          const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(postUrl, normalizedCustomerId);
          return { kind: "ACCEPTED", acceptUrl, campaignsUrl, campaignsPageReady: false };
        }
        if (postClassification === "ALREADY_ACCEPTED") {
          const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(postUrl, normalizedCustomerId);
          const screenshotPath = await this.screenshot(page, "already_accepted_post_confirm");
          return { kind: "ALREADY_ACCEPTED", campaignsUrl, screenshotPath, campaignsPageReady: false };
        }
        if (postClassification === "SIGN_IN_REQUIRED") {
          return { kind: "SIGN_IN_REQUIRED" };
        }

        const screenshotPath = await this.screenshot(page, "manual_action_post_confirm");
        logger.warn({ url: postUrl }, "GmailAcceptExecutor: post-confirm result unclear");
        return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
      }

      case "UNCLEAR":
      default: {
        const screenshotPath = await this.screenshot(page, "manual_action");
        logger.warn(
          { url: pageUrl, pageTextPreview: pageText.slice(0, 200).trim() },
          "GmailAcceptExecutor: result page unclear — requires manual action",
        );
        return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
      }
    }
  }

  /** Finds the first visible Accept / Continue / Confirm button or link. */
  private async findConfirmButton(page: Page): Promise<import("playwright").Locator | null> {
    const buttonLoc = page.getByRole("button", { name: CONFIRM_BUTTON_NAMES }).first();
    if ((await buttonLoc.count().catch(() => 0)) > 0) return buttonLoc;

    const linkLoc = page.getByRole("link", { name: CONFIRM_BUTTON_NAMES }).first();
    if ((await linkLoc.count().catch(() => 0)) > 0) return linkLoc;

    return null;
  }

  private async hasSignInForm(page: Page): Promise<boolean> {
    for (const selector of SIGN_IN_SELECTORS) {
      if ((await page.locator(selector).count().catch(() => 0)) > 0) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Campaigns page helpers
  // ---------------------------------------------------------------------------

  /**
   * Opens campaignsUrl in a new tab and waits for the campaigns table to be ready.
   * If Google redirects to Overview, clicks the left-nav Campaigns item and retries.
   * Returns { ready, screenshotPath }.
   */
  private async openAndWaitForCampaignsPage(
    context: BrowserContext,
    campaignsUrl: string,
  ): Promise<{ ready: boolean; screenshotPath: string | null }> {
    let tab: Page | null = null;
    try {
      tab = await context.newPage();
      await tab.goto(campaignsUrl, { waitUntil: "domcontentloaded", timeout: this.campaignsPageTimeoutMs });
      logger.info({ campaignsUrl }, "GmailAcceptExecutor: campaigns tab opened");

      const ready = await this.waitForCampaignsPageReady(tab);
      if (ready) return { ready: true, screenshotPath: null };

      const screenshotPath = await this.screenshot(tab, "campaigns_not_ready");
      return { ready: false, screenshotPath };
    } catch (err) {
      logger.warn({ err, campaignsUrl }, "GmailAcceptExecutor: error opening campaigns tab");
      const screenshotPath = tab ? await this.screenshot(tab, "campaigns_error").catch(() => null) : null;
      return { ready: false, screenshotPath };
    }
  }

  /**
   * Waits for the Google Ads campaigns table to appear on `page`.
   *
   * Flow:
   *   1. Wait for domcontentloaded.
   *   2. Poll until campaigns-table UI or campaigns URL is confirmed.
   *   3. Settle delay.
   *   4. If still on Overview, click left-nav Campaigns → Campaigns and repeat.
   *   5. Up to CAMPAIGNS_NAV_RETRY_LIMIT retries.
   */
  private async waitForCampaignsPageReady(page: Page): Promise<boolean> {
    for (let attempt = 0; attempt < CAMPAIGNS_NAV_RETRY_LIMIT; attempt++) {
      const found = await this.pollForCampaignsUi(page);

      if (found) {
        await page.waitForTimeout(this.campaignsSettleDelayMs);
        logger.info({ url: page.url(), attempt }, "GmailAcceptExecutor: campaigns page ready");
        return true;
      }

      // Not yet on campaigns — try clicking the left-nav Campaigns link.
      const clicked = await this.clickCampaignsNavItem(page);
      if (!clicked) {
        logger.warn({ url: page.url(), attempt }, "GmailAcceptExecutor: campaigns nav item not found");
        break;
      }

      logger.info({ url: page.url(), attempt }, "GmailAcceptExecutor: clicked Campaigns nav item, waiting");
      await page.waitForLoadState("domcontentloaded", { timeout: this.campaignsPageTimeoutMs }).catch(() => undefined);
    }

    return false;
  }

  /**
   * Polls until the campaigns table UI appears or the URL confirms we are on the
   * campaigns list. Returns true when ready, false on timeout.
   */
  private async pollForCampaignsUi(page: Page): Promise<boolean> {
    const deadline = Date.now() + this.campaignsPageTimeoutMs;
    const pollMs = 2000;

    while (Date.now() < deadline) {
      // URL-based check: already on campaigns list URL.
      if (CAMPAIGNS_URL_PATTERN.test(page.url())) {
        // Confirm page title or table is visible.
        const title = await page.title().catch(() => "");
        if (/campaigns/i.test(title)) return true;

        // Check for campaigns table DOM elements.
        for (const sel of CAMPAIGNS_TABLE_SELECTORS) {
          if ((await page.locator(sel).first().isVisible().catch(() => false))) return true;
        }
      }

      await page.waitForTimeout(pollMs);
    }

    return false;
  }

  /**
   * Attempts to click the Campaigns navigation item in the Google Ads left nav.
   * Returns true if a click was dispatched.
   */
  private async clickCampaignsNavItem(page: Page): Promise<boolean> {
    // Prefer an explicit campaigns href link.
    for (const selector of CAMPAIGNS_NAV_SELECTORS) {
      const loc = page.locator(selector).filter({ hasText: /^Campaigns$/i }).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        await loc.click({ timeout: 8000 }).catch(() => undefined);
        return true;
      }
    }

    // Fallback: any visible link/button with exact text "Campaigns".
    const fallback = page.getByRole("link", { name: /^Campaigns$/i }).first();
    if ((await fallback.count().catch(() => 0)) > 0) {
      await fallback.click({ timeout: 8000 }).catch(() => undefined);
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Screenshot
  // ---------------------------------------------------------------------------

  private async screenshot(page: Page, label: string): Promise<string | null> {
    try {
      await mkdir(this.screenshotDir, { recursive: true });
      const file = path.join(this.screenshotDir, `gmail_accept_${label}_${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      return file;
    } catch {
      return null;
    }
  }
}
