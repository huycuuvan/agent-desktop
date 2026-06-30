import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import type { GmailInvitationAccepter, GmailAcceptOutcome } from "../../domain/repositories/GmailInvitationAccepter.js";
import type { GmailSession } from "../../domain/repositories/GmailInvitationSearcher.js";
import type { GmailInvitationCandidate } from "../../domain/entities/GmailInvitation.js";
import {
  classifyAcceptPage,
  extractCampaignsUrlFromAcceptPageUrl,
} from "../../domain/services/gmailAcceptResultClassifier.js";
import { logger } from "../logger/logger.js";

interface InternalSession {
  page: Page;
}

const ACCEPT_INVITATION_LOCATORS = [
  'a[href*="google.com/ads/um/accept"]',
  'a[href*="accounts.google.com/AcceptInvitation"]',
  '[role="link"]:text("ACCEPT INVITATION")',
  'a:text("ACCEPT INVITATION")',
];

export class GmailAcceptExecutor implements GmailInvitationAccepter {
  constructor(
    private readonly acceptTimeoutMs: number,
    private readonly screenshotDir: string,
  ) {}

  async accept(session: GmailSession, candidate: GmailInvitationCandidate): Promise<GmailAcceptOutcome> {
    const { page } = session as InternalSession;

    try {
      const acceptUrl = candidate.acceptUrl ?? (await this.findAcceptUrl(page));

      if (!acceptUrl) {
        const screenshotPath = await this.screenshot(page, "no_accept_btn");
        logger.warn("GmailAcceptExecutor: ACCEPT INVITATION link not found");
        return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
      }

      await page.goto(acceptUrl, { waitUntil: "networkidle", timeout: this.acceptTimeoutMs });
      await page.waitForTimeout(2000);

      return await this.classifyResultPage(page, acceptUrl, candidate);
    } catch (error) {
      logger.error({ err: error }, "GmailAcceptExecutor: unexpected error");
      const screenshotPath = await this.screenshot(page, "error").catch(() => null);
      return { kind: "FAILED", reason: String(error), screenshotPath };
    }
  }

  private async classifyResultPage(
    page: Page,
    acceptUrl: string,
    candidate: GmailInvitationCandidate,
  ): Promise<GmailAcceptOutcome> {
    const pageText = (await page.textContent("body").catch(() => "")) ?? "";
    const pageUrl = page.url();

    const confirmBtn = page.getByRole("button", { name: /confirm|accept|continue/i }).first();
    const hasConfirmButton = (await confirmBtn.count().catch(() => 0)) > 0;

    const classification = classifyAcceptPage(pageText, hasConfirmButton);

    logger.info(
      {
        classification,
        pageUrl,
        pageTextPreview: pageText.slice(0, 200).trim(),
        hasConfirmButton,
      },
      "GmailAcceptExecutor: result page classification",
    );

    switch (classification) {
      case "ALREADY_ACCEPTED": {
        const normalizedCustomerId = candidate.body.match(/\d{3}-\d{3}-\d{4}/)?.at(0) ?? "";
        const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(pageUrl, normalizedCustomerId);
        const screenshotPath = await this.screenshot(page, "already_accepted");
        logger.info({ campaignsUrl, pageUrl }, "GmailAcceptExecutor: invitation already accepted");
        return { kind: "ALREADY_ACCEPTED", campaignsUrl, screenshotPath };
      }

      case "SUCCESS":
        return { kind: "ACCEPTED", acceptUrl };

      case "EXPIRED_OR_CANCELLED": {
        const screenshotPath = await this.screenshot(page, "expired");
        return { kind: "FAILED", reason: "INVITATION_EXPIRED_OR_CANCELLED", screenshotPath };
      }

      case "NEEDS_CONFIRM": {
        await confirmBtn.click();
        await page.waitForLoadState("networkidle", { timeout: this.acceptTimeoutMs }).catch(() => undefined);
        await page.waitForTimeout(2000);

        const postText = (await page.textContent("body").catch(() => "")) ?? "";
        const postClassification = classifyAcceptPage(postText, false);

        if (postClassification === "SUCCESS") {
          return { kind: "ACCEPTED", acceptUrl };
        }
        if (postClassification === "ALREADY_ACCEPTED") {
          const normalizedCustomerId = candidate.body.match(/\d{3}-\d{3}-\d{4}/)?.at(0) ?? "";
          const campaignsUrl = extractCampaignsUrlFromAcceptPageUrl(page.url(), normalizedCustomerId);
          const screenshotPath = await this.screenshot(page, "already_accepted_post_confirm");
          return { kind: "ALREADY_ACCEPTED", campaignsUrl, screenshotPath };
        }

        const screenshotPath = await this.screenshot(page, "manual_action_post_confirm");
        logger.warn({ url: page.url() }, "GmailAcceptExecutor: post-confirm result unclear");
        return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
      }

      case "UNCLEAR":
      default: {
        const screenshotPath = await this.screenshot(page, "manual_action");
        logger.warn({ url: page.url(), pageTextPreview: pageText.slice(0, 200).trim() },
          "GmailAcceptExecutor: result page unclear — requires manual action");
        return { kind: "MANUAL_ACTION_REQUIRED", screenshotPath };
      }
    }
  }

  private async findAcceptUrl(page: Page): Promise<string | null> {
    for (const selector of ACCEPT_INVITATION_LOCATORS) {
      const el = page.locator(selector).first();
      if ((await el.count().catch(() => 0)) > 0) {
        const href = await el.getAttribute("href").catch(() => null);
        if (href) return href;
      }
    }
    return null;
  }

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
