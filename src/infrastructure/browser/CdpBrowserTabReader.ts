import { chromium } from "playwright";
import type { BrowserTabReader } from "../../domain/repositories/BrowserTabReader.js";
import type { AdsPowerProfile } from "../../domain/entities/AdsPowerProfile.js";
import type { BrowserTab } from "../../domain/entities/BrowserTab.js";
import { logger } from "../logger/logger.js";

export class CdpBrowserTabReader implements BrowserTabReader {
  async listOpenTabs(profile: AdsPowerProfile): Promise<BrowserTab[]> {
    let browser;
    try {
      browser = await chromium.connectOverCDP(profile.wsEndpoint);
      const tabs: BrowserTab[] = [];

      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          tabs.push({
            title: await page.title(),
            url: page.url(),
          });
        }
      }

      return tabs;
    } catch (error) {
      logger.warn(
        { profileId: profile.profileId, err: error },
        "Failed to connect to profile over CDP",
      );
      return [];
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
}
