/**
 * pnpm tabs:cleanup [-- --dry-run]
 *
 * Closes duplicate Campaign tabs and blank/chrome tabs across all AdsPower
 * profiles. Never closes: Gmail, Google Sheets, or the last remaining Campaign
 * tab for any account.
 *
 * --dry-run  Print what would be closed without closing anything.
 */
import { chromium } from "playwright";
import { AdsPowerProfileRepositoryImpl } from "../../infrastructure/adspower/AdsPowerProfileRepositoryImpl.js";
import { BrowserTabManager } from "../../infrastructure/browser/BrowserTabManager.js";
import { env } from "../../infrastructure/config/env.js";

const dryRun = process.argv.includes("--dry-run");

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

  let totalDuplicates = 0;
  let totalBlanks = 0;

  for (const profile of profiles) {
    let browser;
    try {
      browser = await chromium.connectOverCDP(profile.wsEndpoint);
      const tabManager = new BrowserTabManager(browser);

      const { duplicateCampaigns, blanks } = await tabManager.cleanup(dryRun);

      if (duplicateCampaigns.length > 0 || blanks.length > 0) {
        console.log(`\nProfile: ${profile.profileId} (${profile.profileName})`);

        for (const url of duplicateCampaigns) {
          const action = dryRun ? "Would close (duplicate campaign)" : "Closed (duplicate campaign)";
          console.log(`  ${action}: ${url}`);
        }
        for (const url of blanks) {
          const action = dryRun ? "Would close (blank/chrome)" : "Closed (blank/chrome)";
          console.log(`  ${action}: ${url}`);
        }
      }

      totalDuplicates += duplicateCampaigns.length;
      totalBlanks += blanks.length;
    } catch (err) {
      console.error(`  Error connecting to profile ${profile.profileId}:`, err);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  const verb = dryRun ? "Would close" : "Closed";
  console.log(
    `\n${verb}: ${totalDuplicates} duplicate campaign tab(s), ${totalBlanks} blank/chrome tab(s).`,
  );
  if (dryRun) {
    console.log("Run without --dry-run to apply.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
