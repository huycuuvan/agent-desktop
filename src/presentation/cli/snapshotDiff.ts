import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { compareCampaignSnapshots } from "../../domain/services/CampaignDiffEngine.js";

async function main(): Promise<void> {
  const snapshotRepository = new PrismaSnapshotRepository(prisma);

  const latestRun = await snapshotRepository.getLatestRunWithCampaigns();
  if (!latestRun) {
    console.log("No comparable previous run found");
    return;
  }

  const previousRun = await snapshotRepository.getLatestComparableRun(latestRun);
  if (!previousRun) {
    console.log("No comparable previous run found");
    return;
  }

  const { summary, changes } = compareCampaignSnapshots(previousRun.campaigns, latestRun.campaigns);

  console.log(
    JSON.stringify(
      {
        latestRunId: String(latestRun.runId),
        previousRunId: String(previousRun.runId),
        providerCode: latestRun.providerCode,
        dateMode: latestRun.dateMode,
        fromDate: latestRun.fromDate,
        toDate: latestRun.toDate,
        summary,
        changes,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
