import type { Browser, Page } from "playwright";
import type { GoogleAdsOpener, GoogleAdsOpenResult } from "../../domain/repositories/GoogleAdsOpener.js";
import type { GmailSession } from "../../domain/repositories/GmailInvitationSearcher.js";
import { buildGoogleAdsCampaignsUrl } from "../../domain/services/googleAdsCampaignsUrlBuilder.js";
import { BrowserTabManager, extractCustomerIdFromUrl } from "./BrowserTabManager.js";
import { customerIdToDigits } from "../../domain/services/customerIdParser.js";
import { logger } from "../logger/logger.js";

interface InternalSession {
  browser: Browser;
  page: Page;
}

export class GoogleAdsOpenExecutor implements GoogleAdsOpener {
  constructor(
    /** Navigation timeout for the campaigns page (ms). */
    private readonly timeoutMs: number = 60_000,
  ) {}

  async openCampaigns(session: GmailSession, normalizedCustomerId: string): Promise<GoogleAdsOpenResult> {
    const { browser } = session as InternalSession;
    const url = buildGoogleAdsCampaignsUrl(normalizedCustomerId);
    const customerIdDigits = customerIdToDigits(normalizedCustomerId);

    try {
      const tabManager = new BrowserTabManager(browser);

      // Reuse an existing Campaign tab for this account instead of always
      // opening a new one (Part 2 of the Phase 7 spec).
      const page = await tabManager.getOrCreateCampaignTab(url, customerIdDigits, "domcontentloaded", this.timeoutMs);

      // Wait until the URL looks like a real campaigns page (not a redirect).
      try {
        await page.waitForURL(
          (u) => u.pathname.includes("/aw/campaigns") || u.pathname.includes("/aw/overview"),
          { timeout: this.timeoutMs },
        );
      } catch {
        // Not a blocker — the page may already be at the right URL.
      }

      const finalUrl = page.url();
      const finalCustomerId = extractCustomerIdFromUrl(finalUrl) ?? customerIdDigits;
      logger.info(
        { url: finalUrl, customerId: finalCustomerId },
        "GoogleAdsOpenExecutor: campaigns page ready",
      );
      return { opened: true, url: finalUrl };
    } catch (error) {
      logger.warn({ url, err: error }, "GoogleAdsOpenExecutor: failed to open Google Ads page");
      return { opened: false, url };
    }
  }
}
