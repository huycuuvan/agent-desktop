import path from "node:path";
import { env } from "../../infrastructure/config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { AdsPowerProfileRepositoryImpl } from "../../infrastructure/adspower/AdsPowerProfileRepositoryImpl.js";
import { CdpBrowserTabReader } from "../../infrastructure/browser/CdpBrowserTabReader.js";
import { RefreshExecutor } from "../../infrastructure/browser/RefreshExecutor.js";
import { CampaignSearchExecutor } from "../../infrastructure/browser/CampaignSearchExecutor.js";
import { CampaignTableReader } from "../../infrastructure/browser/CampaignTableReader.js";
import { GoogleAdsCollector } from "../../infrastructure/browser/GoogleAdsCollector.js";
import { GoogleAdsDateRangeExecutor } from "../../infrastructure/browser/GoogleAdsDateRangeExecutor.js";
import { GoogleAdsTableReadinessWaiter } from "../../infrastructure/browser/googleAdsTableReadiness.js";
import { ListOpenProfilesWithTabsUseCase } from "../../domain/usecases/ListOpenProfilesWithTabsUseCase.js";
import { CollectGoogleAdsCampaignsUseCase } from "../../domain/usecases/CollectGoogleAdsCampaignsUseCase.js";
import { detectGoogleAdsTabs } from "../../domain/services/googleAdsTabDetector.js";
import type { GoogleAdsTab } from "../../domain/entities/GoogleAdsTab.js";
import type { GoogleAdsAccountReadResult } from "../../domain/entities/GoogleAdsAccountReadResult.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { buildCollectorRunInput } from "../../domain/services/snapshotMapper.js";

const SCREENSHOT_DIR = path.join(process.cwd(), "storage", "screenshots");

async function main(): Promise<void> {
  const startedAt = new Date();
  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const profileRepository = new AdsPowerProfileRepositoryImpl(env.ADSPOWER_API_BASE_URL, env.ADSPOWER_API_KEY);
  const tabReader = new CdpBrowserTabReader();
  const useCase = new ListOpenProfilesWithTabsUseCase(profileRepository, tabReader);

  const readinessWaiter = new GoogleAdsTableReadinessWaiter({
    actionDelayMs: env.GOOGLE_ADS_ACTION_DELAY_MS,
    tableTimeoutMs: env.GOOGLE_ADS_TABLE_TIMEOUT_MS,
    settleDelayMs: env.GOOGLE_ADS_SETTLE_DELAY_MS,
    stableChecks: env.GOOGLE_ADS_STABLE_CHECKS,
    stableIntervalMs: env.GOOGLE_ADS_STABLE_INTERVAL_MS,
  });
  const googleAdsCollector = new GoogleAdsCollector(
    new RefreshExecutor(),
    new GoogleAdsDateRangeExecutor(),
    new CampaignSearchExecutor(),
    new CampaignTableReader(readinessWaiter),
    readinessWaiter,
    SCREENSHOT_DIR,
    {
      scrollOverallTimeoutMs: env.GOOGLE_ADS_TABLE_TIMEOUT_MS,
      scrollPerStepWaitMs: env.GOOGLE_ADS_STABLE_INTERVAL_MS,
    },
  );
  const collectGoogleAdsCampaignsUseCase = new CollectGoogleAdsCampaignsUseCase(googleAdsCollector);

  const results = await useCase.execute();

  if (results.length === 0) {
    logger.info("No open AdsPower profiles found. Make sure AdsPower client is running and profiles are launched.");
    return;
  }

  const allGoogleAdsTabs: GoogleAdsTab[] = [];
  const allAccountResults: GoogleAdsAccountReadResult[] = [];

  for (const { profile, tabs } of results) {
    console.log(`\nProfile: ${profile.profileName} (${profile.profileId})`);
    if (tabs.length === 0) {
      console.log("  (no open tabs)");
    } else {
      tabs.forEach((tab, index) => {
        console.log(`  [${index + 1}] ${tab.title} - ${tab.url}`);
      });
    }

    const googleAdsTabs = detectGoogleAdsTabs(profile.profileId, tabs);
    allGoogleAdsTabs.push(...googleAdsTabs);

    if (googleAdsTabs.length > 0) {
      console.log("  Google Ads tabs:");
      console.log(JSON.stringify(googleAdsTabs, null, 2));

      for (const tab of googleAdsTabs) {
        console.log(`  -> Collecting tab: accountName=${tab.accountName} customerId=${tab.customerId} url=${tab.url}`);
      }

      const accountResults = await collectGoogleAdsCampaignsUseCase.execute(
        profile,
        googleAdsTabs,
        env.WATCH_PROVIDER_CODE,
        env.GOOGLE_ADS_DATE_MODE,
      );
      allAccountResults.push(...accountResults);
    }

    await prisma.profileScan.create({
      data: {
        profileId: profile.profileId,
        profileName: profile.profileName,
        tabCount: tabs.length,
      },
    });
  }

  console.log(`\nDetected ${allGoogleAdsTabs.length} Google Ads tab(s) across ${results.length} profile(s).`);
  console.log("\nGoogle Ads campaign collection:");
  console.log(JSON.stringify(allAccountResults, null, 2));

  const finishedAt = new Date();
  const runInput = buildCollectorRunInput(
    startedAt,
    finishedAt,
    "COMPLETED",
    env.WATCH_PROVIDER_CODE,
    env.GOOGLE_ADS_DATE_MODE,
    allAccountResults,
  );
  const runId = await snapshotRepository.saveRun(runInput);
  console.log(`\nSaved collector_run #${runId} (${runInput.accounts.length} account snapshot(s)).`);
}

main()
  .catch((error) => {
    logger.error({ err: error }, "Desktop agent CLI failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
