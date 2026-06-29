import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";

async function main(): Promise<void> {
  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const summary = await snapshotRepository.getLatestRunSummary();

  if (!summary) {
    console.log("No collector runs found.");
    return;
  }

  console.log(`Run id: ${summary.runId}`);
  console.log(`Accounts count: ${summary.accountsCount}`);
  console.log(`Campaigns count: ${summary.campaignsCount}`);
  console.log(`Failed accounts count: ${summary.failedAccountsCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
