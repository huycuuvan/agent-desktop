import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCollectorRunInput, mapAccountResultToSnapshotInput } from "./snapshotMapper.js";
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

describe("mapAccountResultToSnapshotInput", () => {
  it("maps account-level fields and derives campaignKey per campaign", () => {
    const snapshot = mapAccountResultToSnapshotInput(makeResult());

    assert.equal(snapshot.accountName, "XOY SCAN");
    assert.equal(snapshot.customerId, "8361137753");
    assert.equal(snapshot.reason, null);
    assert.equal(snapshot.campaigns.length, 1);
    assert.equal(snapshot.campaigns[0]!.campaignKey, "8361137753|NQT-MOMO-QKA-PG3-2906|727-700-2311");
    assert.equal(snapshot.campaigns[0]!.campaignName, "NQT-MOMO-QKA-PG3-2906");
  });

  it("falls back to null for optional fields that are undefined", () => {
    const snapshot = mapAccountResultToSnapshotInput(
      makeResult({ accountName: undefined, customerId: undefined, reason: undefined, screenshotPath: undefined }),
    );

    assert.equal(snapshot.accountName, null);
    assert.equal(snapshot.customerId, null);
    assert.equal(snapshot.reason, null);
    assert.equal(snapshot.screenshotPath, null);
  });
});

describe("buildCollectorRunInput", () => {
  it("builds a run with one account snapshot per result and serializes rawJson", () => {
    const startedAt = new Date("2026-06-29T00:00:00Z");
    const finishedAt = new Date("2026-06-29T00:01:00Z");
    const results = [makeResult(), makeResult({ accountName: "Other Account", customerId: "1111111111" })];

    const run = buildCollectorRunInput(startedAt, finishedAt, "COMPLETED", "QKA", "AUTO", results);

    assert.equal(run.status, "COMPLETED");
    assert.equal(run.providerCode, "QKA");
    assert.equal(run.dateMode, "AUTO");
    assert.equal(run.accounts.length, 2);
    assert.deepEqual(JSON.parse(run.rawJson ?? "[]"), results);
  });
});
