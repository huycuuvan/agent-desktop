import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SHEET_COLUMNS, buildSheetRowValues, buildSheetRows } from "./sheetRowMapper.js";
import type { SheetSyncCampaign } from "../entities/SheetSync.js";

function makeCampaign(overrides: Partial<SheetSyncCampaign> = {}): SheetSyncCampaign {
  return {
    campaignKey: "8361137753|NQT-MOMO-QKA-PG3-2906|727-700-2311",
    campaignName: "NQT-MOMO-QKA-PG3-2906",
    account: "727-700-2311",
    customerId: "8361137753",
    accountName: "XOY SCAN",
    providerCode: "QKA",
    dateMode: "AUTO",
    fromDate: "2026-06-28",
    toDate: "2026-06-29",
    budget: "$5,000.00/day",
    status: "Eligible",
    campaignType: "Search",
    impressions: "0",
    interactions: "0",
    interactionRate: null,
    avgCost: null,
    cost: "$0.00",
    conversions: "0.00",
    ...overrides,
  };
}

describe("buildSheetRowValues", () => {
  it("maps every SheetSyncCampaign field to the SHEET_COLUMNS order", () => {
    const campaign = makeCampaign();
    const values = buildSheetRowValues(campaign, 42, "2026-06-30T00:00:00.000Z");

    assert.equal(values.length, SHEET_COLUMNS.length);
    assert.deepEqual(values, [
      "QKA",
      "AUTO",
      "2026-06-28",
      "2026-06-29",
      "8361137753",
      "XOY SCAN",
      "8361137753|NQT-MOMO-QKA-PG3-2906|727-700-2311",
      "NQT-MOMO-QKA-PG3-2906",
      "727-700-2311",
      "$5,000.00/day",
      "Eligible",
      "Search",
      "0",
      "0",
      "",
      "",
      "$0.00",
      "0.00",
      "42",
      "2026-06-30T00:00:00.000Z",
    ]);
  });

  it("converts null fields to empty strings rather than the literal 'null'", () => {
    const campaign = makeCampaign({
      campaignName: null,
      account: null,
      customerId: null,
      accountName: null,
      fromDate: null,
      toDate: null,
      budget: null,
      status: null,
      campaignType: null,
      impressions: null,
      interactions: null,
      interactionRate: null,
      avgCost: null,
      cost: null,
      conversions: null,
    });
    const values = buildSheetRowValues(campaign, 1, "2026-06-30T00:00:00.000Z");

    assert.ok(!values.includes("null"));
  });
});

describe("buildSheetRows", () => {
  it("builds one row per campaign, keyed by campaignKey", () => {
    const campaigns = [makeCampaign(), makeCampaign({ campaignKey: "k2", campaignName: "Other" })];
    const rows = buildSheetRows(campaigns, 7, "2026-06-30T00:00:00.000Z");

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.campaignKey, campaigns[0]!.campaignKey);
    assert.equal(rows[1]!.campaignKey, "k2");
    assert.equal(rows[0]!.values[SHEET_COLUMNS.indexOf("lastSeenRunId")], "7");
  });
});
