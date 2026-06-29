import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentPipelineUseCase } from "./AgentPipelineUseCase.js";
import type { CollectorRunner } from "../repositories/CollectorRunner.js";
import type { SheetsSyncer, SheetsSyncOutcome } from "../repositories/SheetsSyncer.js";
import type { Notifier, NotificationResult } from "../repositories/Notifier.js";
import type { SnapshotRepository } from "../repositories/SnapshotRepository.js";
import type { CollectorRunInput } from "../entities/CollectorRunSnapshot.js";
import type { GoogleAdsAccountReadResult } from "../entities/GoogleAdsAccountReadResult.js";

function makeResult(overrides: Partial<GoogleAdsAccountReadResult> = {}): GoogleAdsAccountReadResult {
  return {
    accountName: "XOY SCAN",
    customerId: "8361137753",
    keyword: "QKA",
    dateMode: "AUTO",
    googleAdsDateLabel: "Last 2 days",
    fromDate: "2026-06-28",
    toDate: "2026-06-29",
    refreshed: true,
    filterChipFound: true,
    visibleRowCount: 1,
    paginationText: "1 - 1 of 1",
    totalFilteredRows: 1,
    campaignsCollected: 1,
    campaignsMissing: 0,
    campaigns: [
      {
        campaignName: "Camp A",
        budget: "$5.00/day",
        status: "Eligible",
        optimizationScore: null,
        account: "727-700-2311",
        campaignType: "Search",
        impressions: "0",
        interactions: "0",
        interactionRate: null,
        avgCost: null,
        cost: "$0.00",
        conversions: "0.00",
      },
    ],
    ...overrides,
  };
}

class FakeCollectorRunner implements CollectorRunner {
  constructor(private readonly behavior: () => Promise<GoogleAdsAccountReadResult[]>) {}

  async collect(): Promise<GoogleAdsAccountReadResult[]> {
    return this.behavior();
  }
}

class FakeSnapshotRepository implements SnapshotRepository {
  public savedRuns: CollectorRunInput[] = [];
  private nextId = 1;

  async saveRun(run: CollectorRunInput): Promise<number> {
    this.savedRuns.push(run);
    return this.nextId++;
  }

  getLatestRunSummary(): Promise<never> {
    throw new Error("not implemented in fake");
  }

  getLatestRunWithCampaigns(): Promise<never> {
    throw new Error("not implemented in fake");
  }

  getLatestComparableRun(): Promise<never> {
    throw new Error("not implemented in fake");
  }

  getLatestRunForSheetsSync(): Promise<never> {
    throw new Error("not implemented in fake");
  }
}

class FakeSheetsSyncer implements SheetsSyncer {
  public callCount = 0;
  public receivedDryRun: boolean[] = [];

  constructor(private readonly behavior: () => Promise<SheetsSyncOutcome>) {}

  async sync(dryRun: boolean): Promise<SheetsSyncOutcome> {
    this.callCount += 1;
    this.receivedDryRun.push(dryRun);
    return this.behavior();
  }
}

class FakeNotifier implements Notifier {
  public callCount = 0;
  public receivedDryRun: boolean[] = [];

  constructor(private readonly behavior: () => Promise<NotificationResult>) {}

  async notifyLatestDiff(dryRun: boolean): Promise<NotificationResult> {
    this.callCount += 1;
    this.receivedDryRun.push(dryRun);
    return this.behavior();
  }
}

describe("AgentPipelineUseCase", () => {
  it("runs collector -> snapshot -> sheets sync and reports a SUCCESS summary", async () => {
    const collector = new FakeCollectorRunner(async () => [
      makeResult({ reason: undefined }),
      makeResult({ accountName: "Other", reason: "DATE_RANGE_NOT_APPLIED" }),
    ]);
    const snapshotRepository = new FakeSnapshotRepository();
    const sheetsSyncer = new FakeSheetsSyncer(async () => ({ appendedRows: 1, updatedRows: 2, skippedRows: 3 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, sheetsSyncer, null, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SUCCESS");
    assert.equal(summary.collectorRunId, 1);
    assert.equal(summary.accounts, 2);
    assert.equal(summary.campaigns, 2);
    assert.equal(summary.failedAccounts, 1);
    assert.equal(summary.sheetsAppendedRows, 1);
    assert.equal(summary.sheetsUpdatedRows, 2);
    assert.equal(summary.sheetsSkippedRows, 3);
    assert.equal(summary.notificationStatus, null);
    assert.ok(summary.durationMs >= 0);
    assert.equal(summary.error, undefined);
    assert.equal(snapshotRepository.savedRuns.length, 1);
    assert.deepEqual(sheetsSyncer.receivedDryRun, [false]);
  });

  it("does not save a snapshot or call Sheets sync when the collector fails", async () => {
    const collector = new FakeCollectorRunner(async () => {
      throw new Error("AdsPower unreachable");
    });
    const snapshotRepository = new FakeSnapshotRepository();
    const sheetsSyncer = new FakeSheetsSyncer(async () => ({ appendedRows: 0, updatedRows: 0, skippedRows: 0 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, sheetsSyncer, null, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "COLLECTOR_FAILED");
    assert.equal(summary.collectorRunId, null);
    assert.equal(summary.accounts, 0);
    assert.equal(summary.campaigns, 0);
    assert.equal(summary.error, "AdsPower unreachable");
    assert.equal(snapshotRepository.savedRuns.length, 0);
    assert.equal(sheetsSyncer.callCount, 0);
  });

  it("keeps the saved snapshot when Sheets sync fails", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const sheetsSyncer = new FakeSheetsSyncer(async () => {
      throw new Error("Sheets API rate limited");
    });

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, sheetsSyncer, null, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SHEETS_FAILED");
    assert.equal(summary.collectorRunId, 1);
    assert.equal(summary.accounts, 1);
    assert.equal(summary.error, "Sheets API rate limited");
    assert.equal(summary.sheetsAppendedRows, 0);
    // The snapshot write already committed before the Sheets failure — it is not rolled back.
    assert.equal(snapshotRepository.savedRuns.length, 1);
  });

  it("reports SUCCESS with zero Sheets counts when no SheetsSyncer is configured", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, null, null, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SUCCESS");
    assert.equal(summary.sheetsAppendedRows, 0);
    assert.equal(summary.sheetsUpdatedRows, 0);
    assert.equal(summary.sheetsSkippedRows, 0);
    assert.equal(snapshotRepository.savedRuns.length, 1);
  });

  it("passes dryRun through to the SheetsSyncer", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const sheetsSyncer = new FakeSheetsSyncer(async () => ({ appendedRows: 5, updatedRows: 0, skippedRows: 0 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, sheetsSyncer, null, "QKA", "AUTO");
    await pipeline.run(true);

    assert.deepEqual(sheetsSyncer.receivedDryRun, [true]);
  });

  it("sends a notification when the diff has changes and reports SENT in the summary", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const notifier = new FakeNotifier(async () => ({ status: "SENT", message: "some message", changeCount: 2 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, null, notifier, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SUCCESS");
    assert.equal(summary.notificationStatus, "SENT");
    assert.equal(summary.notificationMessage, "some message");
    assert.equal(summary.notificationError, undefined);
    assert.deepEqual(notifier.receivedDryRun, [false]);
  });

  it("reports NO_CHANGES without affecting pipeline status when there is nothing to notify", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const notifier = new FakeNotifier(async () => ({ status: "NO_CHANGES", message: null, changeCount: 0 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, null, notifier, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SUCCESS");
    assert.equal(summary.notificationStatus, "NO_CHANGES");
    assert.equal(summary.notificationMessage, null);
  });

  it("does not fail the pipeline when the notifier throws — status becomes SUCCESS_WITH_NOTIFICATION_ERROR", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const notifier = new FakeNotifier(async () => {
      throw new Error("Telegram API down");
    });

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, null, notifier, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SUCCESS_WITH_NOTIFICATION_ERROR");
    assert.equal(summary.collectorRunId, 1);
    assert.equal(summary.notificationError, "Telegram API down");
    assert.equal(snapshotRepository.savedRuns.length, 1);
  });

  it("keeps SHEETS_FAILED status (does not overwrite with notification status) when both sheets and notifier fail", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const sheetsSyncer = new FakeSheetsSyncer(async () => {
      throw new Error("Sheets API rate limited");
    });
    const notifier = new FakeNotifier(async () => {
      throw new Error("Telegram API down");
    });

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, sheetsSyncer, notifier, "QKA", "AUTO");
    const summary = await pipeline.run(false);

    assert.equal(summary.status, "SHEETS_FAILED");
    assert.equal(summary.error, "Sheets API rate limited");
    assert.equal(summary.notificationError, "Telegram API down");
  });

  it("passes dryRun through to the notifier", async () => {
    const collector = new FakeCollectorRunner(async () => [makeResult()]);
    const snapshotRepository = new FakeSnapshotRepository();
    const notifier = new FakeNotifier(async () => ({ status: "DRY_RUN", message: "planned message", changeCount: 1 }));

    const pipeline = new AgentPipelineUseCase(collector, snapshotRepository, null, notifier, "QKA", "AUTO");
    const summary = await pipeline.run(true);

    assert.deepEqual(notifier.receivedDryRun, [true]);
    assert.equal(summary.notificationStatus, "DRY_RUN");
    assert.equal(summary.notificationMessage, "planned message");
  });
});
