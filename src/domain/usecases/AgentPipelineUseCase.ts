import type { CollectorRunner } from "../repositories/CollectorRunner.js";
import type { SnapshotRepository } from "../repositories/SnapshotRepository.js";
import type { SheetsSyncer, SheetsSyncOutcome } from "../repositories/SheetsSyncer.js";
import type { GoogleAdsDateMode } from "../entities/GoogleAdsDateMode.js";
import type { PipelineRunSummary, PipelineStatus } from "../entities/PipelineRunSummary.js";
import { buildCollectorRunInput } from "../services/snapshotMapper.js";

const EMPTY_SHEETS_OUTCOME: SheetsSyncOutcome = { appendedRows: 0, updatedRows: 0, skippedRows: 0 };

export class AgentPipelineUseCase {
  constructor(
    private readonly collectorRunner: CollectorRunner,
    private readonly snapshotRepository: SnapshotRepository,
    private readonly sheetsSyncer: SheetsSyncer | null,
    private readonly providerCode: string,
    private readonly dateMode: GoogleAdsDateMode,
  ) {}

  async run(dryRun: boolean): Promise<PipelineRunSummary> {
    const startedAt = Date.now();

    let results;
    try {
      results = await this.collectorRunner.collect();
    } catch (error) {
      return buildSummary(startedAt, "COLLECTOR_FAILED", null, 0, 0, 0, EMPTY_SHEETS_OUTCOME, toErrorMessage(error));
    }

    const accounts = results.length;
    const campaigns = results.reduce((sum, account) => sum + account.campaigns.length, 0);
    const failedAccounts = results.filter((account) => Boolean(account.reason)).length;

    let collectorRunId: number;
    try {
      const runInput = buildCollectorRunInput(
        new Date(startedAt),
        new Date(),
        "COMPLETED",
        this.providerCode,
        this.dateMode,
        results,
      );
      collectorRunId = await this.snapshotRepository.saveRun(runInput);
    } catch (error) {
      return buildSummary(
        startedAt,
        "SNAPSHOT_FAILED",
        null,
        accounts,
        campaigns,
        failedAccounts,
        EMPTY_SHEETS_OUTCOME,
        toErrorMessage(error),
      );
    }

    if (!this.sheetsSyncer) {
      return buildSummary(startedAt, "SUCCESS", collectorRunId, accounts, campaigns, failedAccounts, EMPTY_SHEETS_OUTCOME);
    }

    try {
      const sheetsOutcome = await this.sheetsSyncer.sync(dryRun);
      return buildSummary(startedAt, "SUCCESS", collectorRunId, accounts, campaigns, failedAccounts, sheetsOutcome);
    } catch (error) {
      return buildSummary(
        startedAt,
        "SHEETS_FAILED",
        collectorRunId,
        accounts,
        campaigns,
        failedAccounts,
        EMPTY_SHEETS_OUTCOME,
        toErrorMessage(error),
      );
    }
  }
}

function buildSummary(
  startedAt: number,
  status: PipelineStatus,
  collectorRunId: number | null,
  accounts: number,
  campaigns: number,
  failedAccounts: number,
  sheets: SheetsSyncOutcome,
  error?: string,
): PipelineRunSummary {
  return {
    collectorRunId,
    accounts,
    campaigns,
    failedAccounts,
    sheetsAppendedRows: sheets.appendedRows,
    sheetsUpdatedRows: sheets.updatedRows,
    sheetsSkippedRows: sheets.skippedRows,
    durationMs: Date.now() - startedAt,
    status,
    ...(error ? { error } : {}),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
