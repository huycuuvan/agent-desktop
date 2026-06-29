import { env } from "../../infrastructure/config/env.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { SheetsClient } from "../../infrastructure/sheets/SheetsClient.js";
import { SheetsSyncExecutor } from "../../infrastructure/sheets/SheetsSyncExecutor.js";
import { buildSheetRows } from "../../domain/services/sheetRowMapper.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SHEETS_CREDENTIALS_PATH) {
    console.log(
      "Missing GOOGLE_SHEETS_SPREADSHEET_ID and/or GOOGLE_SHEETS_CREDENTIALS_PATH. Set both in .env before running sheets:sync.",
    );
    process.exitCode = 1;
    return;
  }

  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const latestRun = await snapshotRepository.getLatestRunForSheetsSync();

  if (!latestRun) {
    console.log("No collector runs found.");
    return;
  }

  const lastSeenAt = new Date().toISOString();
  const incomingRows = buildSheetRows(latestRun.campaigns, latestRun.runId, lastSeenAt);

  const sheetsClient = new SheetsClient(env.GOOGLE_SHEETS_CREDENTIALS_PATH);
  const executor = new SheetsSyncExecutor(sheetsClient);
  const result = await executor.sync(env.GOOGLE_SHEETS_SPREADSHEET_ID, env.GOOGLE_SHEETS_TAB_NAME, incomingRows, dryRun);

  if (dryRun) {
    console.log("Dry run — no changes written to Google Sheets.");
    console.log(JSON.stringify(result.actions, null, 2));
  }

  console.log(
    JSON.stringify(
      {
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        tabName: env.GOOGLE_SHEETS_TAB_NAME,
        latestRunId: latestRun.runId,
        appendedRows: result.appendedRows,
        updatedRows: result.updatedRows,
        skippedRows: result.skippedRows,
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
