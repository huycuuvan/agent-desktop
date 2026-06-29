import type { SheetsSyncer, SheetsSyncOutcome } from "../../domain/repositories/SheetsSyncer.js";
import type { SnapshotRepository } from "../../domain/repositories/SnapshotRepository.js";
import { buildSheetRows } from "../../domain/services/sheetRowMapper.js";
import { SheetsClient } from "./SheetsClient.js";
import { SheetsSyncExecutor } from "./SheetsSyncExecutor.js";

export class SnapshotSheetsSyncer implements SheetsSyncer {
  private readonly executor: SheetsSyncExecutor;

  constructor(
    private readonly snapshotRepository: SnapshotRepository,
    sheetsClient: SheetsClient,
    private readonly spreadsheetId: string,
    private readonly tabName: string,
  ) {
    this.executor = new SheetsSyncExecutor(sheetsClient);
  }

  async sync(dryRun: boolean): Promise<SheetsSyncOutcome> {
    const latestRun = await this.snapshotRepository.getLatestRunForSheetsSync();

    if (!latestRun) {
      return { appendedRows: 0, updatedRows: 0, skippedRows: 0 };
    }

    const lastSeenAt = new Date().toISOString();
    const incomingRows = buildSheetRows(latestRun.campaigns, latestRun.runId, lastSeenAt);

    const result = await this.executor.sync(this.spreadsheetId, this.tabName, incomingRows, dryRun);

    return { appendedRows: result.appendedRows, updatedRows: result.updatedRows, skippedRows: result.skippedRows };
  }
}
