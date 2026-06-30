import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import type { GmailInvitationAccepter, GmailAcceptOutcome } from "../../domain/repositories/GmailInvitationAccepter.js";
import type { GmailSession } from "../../domain/repositories/GmailInvitationSearcher.js";
import type { GmailInvitationCandidate } from "../../domain/entities/GmailInvitation.js";
import {
  classifyAcceptPage,
  extractCampaignsUrlFromAcceptPageUrl,
} from "../../domain/services/gmailAcceptResultClassifier.js";
import { BrowserTabManager, extractCustomerIdFromUrl } from "./BrowserTabManager.js";
import { customerIdToDigits } from "../../domain/services/customerIdParser.js";
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

/**
 * Statuses after which the accept tab can be safely closed:
 * the user has no further need to inspect it.
 */
const CLOSE_ACCEPT_TAB_KINDS = new Set<GmailAcceptOutcome["kind"]>([
  "ACCEPTED",
  "ALREADY_ACCEPTED",
]);

export class GmailAcceptExecutor implements GmailInvitationAccepter {
  constructor(
    private readonly acceptTimeoutMs: number,
    private readonly screenshotDir: string,
    private readonly acceptPageTimeoutMs: number = 90000,
    private readonly acceptSettleDelayMs: number = 1500,
    private readonly campaignsPageTimeoutMs: number = 120000,
    private readonly campaignsSettleDelayMs: number = 2000,
  ) {}

  async accept(session: GmailSession, candidate: GmailInvitationCandidate): Promise<GmailAcceptOutcome> {
    const { browser, page: gmailPage } = session as InternalSession;

    const acceptUrl = candidate.acceptUrl ?? null;
    if (!acceptUrl) {
      const screenshotPath = await this.screenshot(gmailPage, "no_accept_url");
      logger.warn("GmailAcceptExecutor: no acceptUrl on candidate");
      return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
    }

    const context = browser.contexts()[0];
    if (!context) {
      return { kind: "FAILED", reason: "No browser context available", screenshotPath: null };
    }

    let acceptPage: Page | null = null;
    try {
      acceptPage = await context.newPage();
      await acceptPage.goto(acceptUrl, { waitUntil: "domcontentloaded", timeout: this.acceptPageTimeoutMs });

      // Wait for the page body to have enough content to classify.
      const ready = await this.waitForAcceptPageReady(acceptPage);
      if (!ready) {
        logger.warn({ acceptUrl }, "GmailAcceptExecutor: accept page not ready within timeout");
        await this.screenshot(acceptPage, "not_ready").catch(() => null);
        return { kind: "ACCEPT_PAGE_NOT_READY_TIMEOUT" };
      }

      const normalizedCustomerId = candidate.body.match(/\d{3}-\d{3}-\d{4}/)?.at(0) ?? "";
      const outcome = await this.classifyAndAct(acceptPage, acceptUrl, normalizedCustomerId);

      // Reuse/open the campaign tab, then close the accept tab on success.
      if (outcome.kind === "ACCEPTED" || outcome.kind === "ALREADY_ACCEPTED") {
        const campaignsUrl =
          outcome.campaignsUrl ??
          extractCampaignsUrlFromAcceptPageUrl(acceptPage.url(), normalizedCustomerId);

        const tabManager = new BrowserTabManager(browser);

        // Extract ocid from the campaigns URL directly — do NOT rely on the body regex
        // which may be empty if the email format doesn't match /\d{3}-\d{3}-\d{4}/.
        const customerIdDigits =
          (campaignsUrl ? extractCustomerIdFromUrl(campaignsUrl) : null) ??
          (normalizedCustomerId ? customerIdToDigits(normalizedCustomerId) : "");

        logger.info(
          { campaignsUrl, customerIdDigits },
          "GmailAcceptExecutor: opening campaigns page after accept",
        );

        const campaignsResult = await this.openAndWaitForCampaignsPage(
          tabManager,
          campaignsUrl,
          customerIdDigits,
        );

        // Close accept tab after confirmed success.
        if (campaignsResult.ready && acceptPage && !acceptPage.isClosed()) {
          logger.info({ acceptUrl }, "GmailAcceptExecutor: closing accept tab after success");
          await acceptPage.close().catch(() => undefined);
        }

        // Remove any duplicate campaign tabs for this ocid that may remain.
        if (campaignsResult.ready && customerIdDigits) {
          await tabManager
            .cleanupDuplicateCampaignTabs(false, customerIdDigits)
            .catch((err) =>
              logger.warn({ err, customerIdDigits }, "GmailAcceptExecutor: cleanup duplicate tabs failed"),
            );
        }

        if (!campaignsResult.ready) {
          logger.warn({ campaignsUrl }, "GmailAcceptExecutor: campaigns page not ready after accept");
          return {
            kind: "MANUAL_ACTION_REQUIRED",
            reason: "CAMPAIGNS_PAGE_NOT_READY",
            screenshotPath: campaignsResult.screenshotPath,
          };
        }

        return { ...outcome, campaignsUrl, campaignsPageReady: true };
      }

      // Part 9: if MANUAL_ACTION_REQUIRED but we have an ocid, try opening the campaigns page directly.
      if (outcome.kind === "MANUAL_ACTION_REQUIRED") {
        const ocidFromAcceptUrl = extractCustomerIdFromUrl(acceptPage.url());
        const ocid = ocidFromAcceptUrl ?? (normalizedCustomerId ? customerIdToDigits(normalizedCustomerId) : null);
        if (ocid) {
          const campaignsUrl = `https://ads.google.com/aw/campaigns?ocid=${ocid}`;
          const tabManager = new BrowserTabManager(browser);
          const campaignsResult = await this.openAndWaitForCampaignsPage(tabManager, campaignsUrl, ocid);
          if (campaignsResult.ready) {
            logger.info(
              { ocid, campaignsUrl },
              "GmailAcceptExecutor: campaigns page opened directly — treating as ALREADY_ACCEPTED",
            );
            if (acceptPage && !acceptPage.isClosed()) {
              await acceptPage.close().catch(() => undefined);
            }
            await tabManager
              .cleanupDuplicateCampaignTabs(false, ocid)
              .catch(() => undefined);
            return {
              kind: "ALREADY_ACCEPTED",
              campaignsUrl,
              screenshotPath: null,
              campaignsPageReady: true,
            };
          }
        }
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

  private async waitForAcceptPageReady(page: Page): Promise<boolean> {
    try {
      // Wait for the body to contain enough text for classification.
      await page.waitForFunction(
        () => {
          const text = document.body?.textContent ?? "";
          return text.trim().length > 50;
        },
        { timeout: this.acceptPageTimeoutMs, polling: 1000 },
      );

      // Settle briefly so dynamic content finishes rendering.
      await page.waitForLoadState("networkidle", { timeout: this.acceptSettleDelayMs }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
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
        logger.info({ btnText: btnText?.trim(), pageUrl }, "GmailAcceptExecutor: clicking confirm button");
        await confirmBtn!.click();

        // Wait for the page to navigate / update after click.
        await page.waitForLoadState("domcontentloaded", { timeout: this.acceptPageTimeoutMs }).catch(() => undefined);
        await page.waitForURL((u) => u.href !== pageUrl, { timeout: 5000 }).catch(() => undefined);

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
   * Opens (or reuses via BrowserTabManager) the campaigns page and waits until
   * the table is ready. Supports the Part 9 direct-open flow.
   */
  private async openAndWaitForCampaignsPage(
    tabManager: BrowserTabManager,
    campaignsUrl: string,
    customerIdDigits: string,
  ): Promise<{ ready: boolean; screenshotPath: string | null }> {
    let tab: Page | null = null;
    try {
      tab = await tabManager.getOrCreateCampaignTab(
        campaignsUrl,
        customerIdDigits,
        "domcontentloaded",
        this.campaignsPageTimeoutMs,
      );
      logger.info({ campaignsUrl }, "GmailAcceptExecutor: campaigns tab ready");

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

  private async waitForCampaignsPageReady(page: Page): Promise<boolean> {
    for (let attempt = 0; attempt < CAMPAIGNS_NAV_RETRY_LIMIT; attempt++) {
      const found = await this.pollForCampaignsUi(page);

      if (found) {
        // Settle: wait for network to quiet down so the table data is fully loaded.
        await page.waitForLoadState("networkidle", { timeout: this.campaignsSettleDelayMs }).catch(() => undefined);
        logger.info({ url: page.url(), attempt }, "GmailAcceptExecutor: campaigns page ready");
        return true;
      }

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

  private async pollForCampaignsUi(page: Page): Promise<boolean> {
    const deadline = Date.now() + this.campaignsPageTimeoutMs;
    const pollMs = 1500;

    while (Date.now() < deadline) {
      if (CAMPAIGNS_URL_PATTERN.test(page.url())) {
        const title = await page.title().catch(() => "");
        if (/campaigns/i.test(title)) return true;

        for (const sel of CAMPAIGNS_TABLE_SELECTORS) {
          if (await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
        }
      }

      try {
        // Use waitForSelector instead of polling timeout for better responsiveness.
        await page.waitForSelector(CAMPAIGNS_TABLE_SELECTORS[0], { timeout: pollMs }).catch(() => undefined);
      } catch {
        // continue loop
      }

      await page.waitForTimeout(pollMs);
    }

    return false;
  }

  private async clickCampaignsNavItem(page: Page): Promise<boolean> {
    for (const selector of CAMPAIGNS_NAV_SELECTORS) {
      const loc = page.locator(selector).filter({ hasText: /^Campaigns$/i }).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        await loc.click({ timeout: 8000 }).catch(() => undefined);
        return true;
      }
    }

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
