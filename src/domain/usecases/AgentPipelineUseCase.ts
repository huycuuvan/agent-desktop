import type { CollectorRunner } from "../repositories/CollectorRunner.js";
import type { SnapshotRepository } from "../repositories/SnapshotRepository.js";
import type { SheetsSyncer, SheetsSyncOutcome } from "../repositories/SheetsSyncer.js";
import type { Notifier } from "../repositories/Notifier.js";
import type { GoogleAdsDateMode } from "../entities/GoogleAdsDateMode.js";
import type { PipelineRunSummary, PipelineStatus } from "../entities/PipelineRunSummary.js";
import { buildCollectorRunInput } from "../services/snapshotMapper.js";

const EMPTY_SHEETS_OUTCOME: SheetsSyncOutcome = { appendedRows: 0, updatedRows: 0, skippedRows: 0 };

export class AgentPipelineUseCase {
  constructor(
    private readonly collectorRunner: CollectorRunner,
    private readonly snapshotRepository: SnapshotRepository,
    private readonly sheetsSyncer: SheetsSyncer | null,
    private readonly notifier: Notifier | null,
    private readonly providerCode: string,
    private readonly dateMode: GoogleAdsDateMode,
  ) {}

  async run(dryRun: boolean): Promise<PipelineRunSummary> {
    const startedAt = Date.now();

    let results;
    try {
      results = await this.collectorRunner.collect();
    } catch (error) {
      return buildSummary(startedAt, "COLLECTOR_FAILED", null, 0, 0, 0, EMPTY_SHEETS_OUTCOME, {
        error: toErrorMessage(error),
      });
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
      return buildSummary(startedAt, "SNAPSHOT_FAILED", null, accounts, campaigns, failedAccounts, EMPTY_SHEETS_OUTCOME, {
        error: toErrorMessage(error),
      });
    }

    let status: PipelineStatus = "SUCCESS";
    let sheetsOutcome = EMPTY_SHEETS_OUTCOME;
    let sheetsError: string | undefined;

    if (this.sheetsSyncer) {
      try {
        sheetsOutcome = await this.sheetsSyncer.sync(dryRun);
      } catch (error) {
        status = "SHEETS_FAILED";
        sheetsError = toErrorMessage(error);
      }
    }

    let notificationStatus: string | null = null;
    let notificationMessage: string | null = null;
    let notificationError: string | undefined;

    if (this.notifier) {
      try {
        const notifyResult = await this.notifier.notifyLatestDiff(dryRun);
        notificationStatus = notifyResult.status;
        notificationMessage = notifyResult.message;
      } catch (error) {
        notificationError = toErrorMessage(error);
        if (status === "SUCCESS") {
          status = "SUCCESS_WITH_NOTIFICATION_ERROR";
        }
      }
    }

    return buildSummary(startedAt, status, collectorRunId, accounts, campaigns, failedAccounts, sheetsOutcome, {
      error: sheetsError,
      notificationStatus,
      notificationMessage,
      notificationError,
    });
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
  extra: {
    error?: string;
    notificationStatus?: string | null;
    notificationMessage?: string | null;
    notificationError?: string;
  },
): PipelineRunSummary {
  return {
    collectorRunId,
    accounts,
    campaigns,
    failedAccounts,
    sheetsAppendedRows: sheets.appendedRows,
    sheetsUpdatedRows: sheets.updatedRows,
    sheetsSkippedRows: sheets.skippedRows,
    notificationStatus: extra.notificationStatus ?? null,
    notificationMessage: extra.notificationMessage ?? null,
    durationMs: Date.now() - startedAt,
    status,
    ...(extra.error ? { error: extra.error } : {}),
    ...(extra.notificationError ? { notificationError: extra.notificationError } : {}),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
