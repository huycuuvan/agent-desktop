import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaSnapshotRepository } from "./PrismaSnapshotRepository.js";
import { buildCollectorRunInput } from "../../domain/services/snapshotMapper.js";
import type { GoogleAdsAccountReadResult } from "../../domain/entities/GoogleAdsAccountReadResult.js";

const testDbPath = path.join(process.cwd(), "prisma", "test-snapshot-repository.db");
const testDatabaseUrl = `file:${testDbPath}`;

execSync("npx prisma db push --skip-generate", {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  stdio: "ignore",
});

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });

after(async () => {
  await prisma.$disconnect();
  for (const suffix of ["", "-journal"]) {
    const file = testDbPath + suffix;
    if (fs.existsSync(file)) {
      fs.rmSync(file);
    }
  }
});

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
        campaignName: "NQT-MOMO-QKA-PG3-2906",
        budget: "$5,000.00/day",
        status: "Eligible",
        optimizationScore: "97.5%",
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
    screenshotPath: "storage/screenshots/example.png",
    ...overrides,
  };
}

describe("PrismaSnapshotRepository", () => {
  it("writes a run with account and campaign snapshots and reads back a summary", async () => {
    const repository = new PrismaSnapshotRepository(prisma);
    const startedAt = new Date("2026-06-29T00:00:00Z");
    const finishedAt = new Date("2026-06-29T00:01:00Z");
    const results = [
      makeResult(),
      makeResult({ accountName: "Failing Account", customerId: "2222222222", campaigns: [], reason: "TABLE_NOT_READY_TIMEOUT" }),
    ];

    const runInput = buildCollectorRunInput(startedAt, finishedAt, "COMPLETED", "QKA", "AUTO", results);
    const runId = await repository.saveRun(runInput);

    assert.equal(typeof runId, "number");

    const summary = await repository.getLatestRunSummary();
    assert.ok(summary);
    assert.equal(summary!.runId, runId);
    assert.equal(summary!.accountsCount, 2);
    assert.equal(summary!.campaignsCount, 1);
    assert.equal(summary!.failedAccountsCount, 1);
  });

  it("finds a comparable previous run matching providerCode, dateMode, fromDate and toDate", async () => {
    const repository = new PrismaSnapshotRepository(prisma);

    const previousRunInput = buildCollectorRunInput(
      new Date("2026-06-27T00:00:00Z"),
      new Date("2026-06-27T00:01:00Z"),
      "COMPLETED",
      "QKA",
      "AUTO",
      [makeResult({ fromDate: "2026-06-25", toDate: "2026-06-26" })],
    );
    await repository.saveRun(previousRunInput);

    const incomparableRunInput = buildCollectorRunInput(
      new Date("2026-06-28T00:00:00Z"),
      new Date("2026-06-28T00:01:00Z"),
      "COMPLETED",
      "QKA",
      "AUTO",
      [makeResult({ fromDate: "2026-06-20", toDate: "2026-06-21" })],
    );
    await repository.saveRun(incomparableRunInput);

    const latestRunInput = buildCollectorRunInput(
      new Date("2026-06-29T00:00:00Z"),
      new Date("2026-06-29T00:01:00Z"),
      "COMPLETED",
      "QKA",
      "AUTO",
      [makeResult({ fromDate: "2026-06-25", toDate: "2026-06-26" })],
    );
    const latestRunId = await repository.saveRun(latestRunInput);

    const latestRun = await repository.getLatestRunWithCampaigns();
    assert.ok(latestRun);
    assert.equal(latestRun!.runId, latestRunId);

    const previousRun = await repository.getLatestComparableRun(latestRun!);
    assert.ok(previousRun);
    assert.equal(previousRun!.fromDate, "2026-06-25");
    assert.equal(previousRun!.toDate, "2026-06-26");
    assert.notEqual(previousRun!.runId, latestRunId);
  });

  it("returns null when no previous run shares the same fromDate/toDate", async () => {
    const repository = new PrismaSnapshotRepository(prisma);

    const onlyRunInput = buildCollectorRunInput(
      new Date("2026-06-29T00:00:00Z"),
      new Date("2026-06-29T00:01:00Z"),
      "COMPLETED",
      "ZZZ",
      "AUTO",
      [makeResult({ keyword: "ZZZ", fromDate: "2026-06-29", toDate: "2026-06-29" })],
    );
    await repository.saveRun(onlyRunInput);

    const latestRun = await repository.getLatestRunWithCampaigns();
    assert.ok(latestRun);

    const previousRun = await repository.getLatestComparableRun(latestRun!);
    assert.equal(previousRun, null);
  });
});
