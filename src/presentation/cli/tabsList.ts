/**
 * pnpm tabs:list
 *
 * Lists all open browser tabs across all AdsPower profiles,
 * showing: profile · index · type · title · url
 */
import { chromium } from "playwright";
import { AdsPowerProfileRepositoryImpl } from "../../infrastructure/adspower/AdsPowerProfileRepositoryImpl.js";
import { BrowserTabManager } from "../../infrastructure/browser/BrowserTabManager.js";
import { env } from "../../infrastructure/config/env.js";

async function main(): Promise<void> {
  const profileRepository = new AdsPowerProfileRepositoryImpl(
    env.ADSPOWER_API_BASE_URL,
    env.ADSPOWER_API_KEY,
  );

  const profiles = await profileRepository.listOpenProfiles();
  if (profiles.length === 0) {
    console.log("No open AdsPower profiles found.");
    return;
  }

  for (const profile of profiles) {
    let browser;
    try {
      browser = await chromium.connectOverCDP(profile.wsEndpoint);
      const tabManager = new BrowserTabManager(browser);
      const tabs = await tabManager.listTabs();

      console.log(`\nProfile: ${profile.profileId} (${profile.profileName})`);
      console.log("─".repeat(80));

      if (tabs.length === 0) {
        console.log("  (no tabs)");
        continue;
      }

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const title = tab.title.slice(0, 50).padEnd(50);
        const url = tab.url.slice(0, 80);
        console.log(`  [${String(i).padStart(2)}] ${tab.type.padEnd(22)} ${title}  ${url}`);
      }
    } catch (err) {
      console.error(`  Error connecting to profile ${profile.profileId}:`, err);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
