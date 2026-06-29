import { env } from "../../infrastructure/config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { GoogleAdsCollectorRunner } from "../../infrastructure/collector/GoogleAdsCollectorRunner.js";
import { buildCollectorRunInput } from "../../domain/services/snapshotMapper.js";

async function main(): Promise<void> {
  const startedAt = new Date();
  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const collectorRunner = new GoogleAdsCollectorRunner();

  const allAccountResults = await collectorRunner.collect();

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
