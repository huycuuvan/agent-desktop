import type { Page } from "playwright";
import type { GoogleAdsOpener, GoogleAdsOpenResult } from "../../domain/repositories/GoogleAdsOpener.js";
import type { GmailSession } from "../../domain/repositories/GmailInvitationSearcher.js";
import { buildGoogleAdsCampaignsUrl } from "../../domain/services/googleAdsCampaignsUrlBuilder.js";
import { logger } from "../logger/logger.js";

interface InternalSession {
  page: Page;
}

export class GoogleAdsOpenExecutor implements GoogleAdsOpener {
  async openCampaigns(session: GmailSession, normalizedCustomerId: string): Promise<GoogleAdsOpenResult> {
    const { page } = session as InternalSession;
    const url = buildGoogleAdsCampaignsUrl(normalizedCustomerId);

    try {
      const context = page.context();
      const newPage = await context.newPage();
      await newPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      logger.info({ url }, "GoogleAdsOpenExecutor: opened Google Ads campaigns page");
      return { opened: true, url };
    } catch (error) {
      logger.warn({ url, err: error }, "GoogleAdsOpenExecutor: failed to open Google Ads page");
      return { opened: false, url };
    }
  }
}
