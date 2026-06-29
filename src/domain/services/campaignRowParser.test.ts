import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCampaignStableKey, buildHeaderIndexMap, mergeCampaignRows, parseCampaignRow, parsePaginationText } from "./campaignRowParser.js";
import type { CampaignRow } from "../entities/CampaignRow.js";

// Captured live from a real Google Ads campaigns table (role="columnheader" innerText values).
const REAL_HEADER_TEXTS = [
  "",
  "Campaign",
  "Budget\nhelp_outline",
  "Status\nhelp_outline",
  "Optimization score\nhelp_outline",
  "Account",
  "Campaign type\nhelp_outline",
  "TrueView avg. CPV\nhelp_outline",
  "Avg. CPM\nhelp_outline",
  "Impr.\nhelp_outline",
  "Interactions\nhelp_outline",
  "Interaction rate\nhelp_outline",
  "Avg. cost\nhelp_outline",
  "Cost\nhelp_outline",
  "Conv. (Platform Comparable)\nhelp_outline",
  "Cost / Conv. (Platform Comparable)\nhelp_outline",
  "Conv. value / Cost (Platform Comparable)\nhelp_outline",
  "Bid strategy type\nhelp_outline",
  "Participated in-app actions\nhelp_outline",
  "Clicks\nhelp_outline",
  "Participated installs\nhelp_outline",
  "Conv. value\nhelp_outline",
  "Conv. value / cost\nhelp_outline",
  "Conversions\nhelp_outline",
  "Cost / Participated in-app action\nhelp_outline",
  "Avg. CPC\nhelp_outline",
  "Cost / conv.\nhelp_outline",
  "Original conv. value\nhelp_outline",
];

// Captured live from the first data row of the same table.
const REAL_ROW_CELL_TEXTS = [
  "",
  "",
  "NQT-MOMO-QKA-PG3-2906\nsettings",
  "$5,000.00/day",
  "Eligible",
  "add_add\n97.5%",
  "727-700-2311",
  "Search",
  "—",
  "—",
  "0",
  "0",
  "—",
  "—",
  "$0.00",
  "—",
  "—",
  "—",
  "Manual CPC",
  "0.00",
  "0",
  "0.00",
  "0.00",
  "0.00",
  "0.00",
  "—",
  "—",
  "$0.00",
  "0.00",
];

describe("buildHeaderIndexMap", () => {
  it("maps normalized header names to their index, stripping icon noise", () => {
    const map = buildHeaderIndexMap(REAL_HEADER_TEXTS);
    assert.equal(map["Campaign"], 1);
    assert.equal(map["Budget"], 2);
    assert.equal(map["Status"], 3);
    assert.equal(map["Optimization score"], 4);
    assert.equal(map["Account"], 5);
    assert.equal(map["Campaign type"], 6);
    assert.equal(map["Impr."], 9);
    assert.equal(map["Interactions"], 10);
    assert.equal(map["Interaction rate"], 11);
    assert.equal(map["Avg. cost"], 12);
    assert.equal(map["Cost"], 13);
    assert.equal(map["Conversions"], 23);
  });

  it("ignores empty header cells", () => {
    const map = buildHeaderIndexMap(["", " ", "Campaign"]);
    assert.deepEqual(Object.keys(map), ["Campaign"]);
  });
});

describe("parseCampaignRow", () => {
  it("extracts every field from a real campaign row using the header offset", () => {
    const headerIndexMap = buildHeaderIndexMap(REAL_HEADER_TEXTS);
    const row = parseCampaignRow(headerIndexMap, REAL_ROW_CELL_TEXTS);

    assert.equal(row.campaignName, "NQT-MOMO-QKA-PG3-2906");
    assert.match(row.campaignName ?? "", /QKA/);
    assert.equal(row.budget, "$5,000.00/day");
    assert.equal(row.status, "Eligible");
    assert.equal(row.optimizationScore, "97.5%");
    assert.equal(row.account, "727-700-2311");
    assert.equal(row.campaignType, "Search");
    assert.equal(row.impressions, "0");
    assert.equal(row.interactions, "0");
    assert.equal(row.interactionRate, null);
    assert.equal(row.avgCost, null);
    assert.equal(row.cost, "$0.00");
    assert.equal(row.conversions, "0.00");
  });

  it("returns null for fields whose column is missing from the header map", () => {
    const headerIndexMap = buildHeaderIndexMap(["", "Campaign"]);
    const row = parseCampaignRow(headerIndexMap, ["", "", "Some Campaign\nsettings"]);

    assert.equal(row.campaignName, "Some Campaign");
    assert.equal(row.budget, null);
    assert.equal(row.status, null);
  });

  it("returns null when the cell value is an em dash placeholder", () => {
    const headerIndexMap = buildHeaderIndexMap(["", "Campaign", "Budget"]);
    const row = parseCampaignRow(headerIndexMap, ["", "", "Campaign A\nsettings", "—"]);
    assert.equal(row.budget, null);
  });
});

describe("parsePaginationText", () => {
  it("parses a real pagination string into the total filtered row count", () => {
    assert.deepEqual(parsePaginationText("1 - 15 of 15"), {
      paginationText: "1 - 15 of 15",
      totalFilteredRows: 15,
    });
  });

  it("returns zero rows and null text when there is no pagination text", () => {
    assert.deepEqual(parsePaginationText(null), { paginationText: null, totalFilteredRows: 0 });
    assert.deepEqual(parsePaginationText(""), { paginationText: null, totalFilteredRows: 0 });
  });

  it("falls back to zero rows if the text doesn't contain a parseable total", () => {
    assert.deepEqual(parsePaginationText("no campaigns"), {
      paginationText: "no campaigns",
      totalFilteredRows: 0,
    });
  });
});

function makeCampaignRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
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
    ...overrides,
  };
}

describe("buildCampaignStableKey", () => {
  it("combines campaignName, account, and budget case-insensitively", () => {
    const lower = makeCampaignRow({ campaignName: "abc", account: "111", budget: "$1/day" });
    const upper = makeCampaignRow({ campaignName: "ABC", account: "111", budget: "$1/day" });
    assert.equal(buildCampaignStableKey(lower), buildCampaignStableKey(upper));
  });

  it("produces different keys when campaignName, account, or budget differ", () => {
    const base = makeCampaignRow();
    const differentAccount = makeCampaignRow({ account: "999-999-9999" });
    const differentBudget = makeCampaignRow({ budget: "$1.00/day" });
    assert.notEqual(buildCampaignStableKey(base), buildCampaignStableKey(differentAccount));
    assert.notEqual(buildCampaignStableKey(base), buildCampaignStableKey(differentBudget));
  });

  it("tolerates null fields without throwing", () => {
    const row = makeCampaignRow({ campaignName: null, account: null, budget: null });
    assert.equal(buildCampaignStableKey(row), "||||");
  });
});

describe("mergeCampaignRows", () => {
  it("adds rows not already collected and reports how many were new", () => {
    const collected = [makeCampaignRow({ campaignName: "A" })];
    const incoming = [makeCampaignRow({ campaignName: "A" }), makeCampaignRow({ campaignName: "B", account: "222" })];

    const { merged, addedCount } = mergeCampaignRows(collected, incoming);

    assert.equal(addedCount, 1);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((row) => row.campaignName), ["A", "B"]);
  });

  it("reports zero added rows when every incoming row is already collected (simulating a scroll with no new rows)", () => {
    const collected = [makeCampaignRow({ campaignName: "A" }), makeCampaignRow({ campaignName: "B", account: "222" })];
    const incoming = [makeCampaignRow({ campaignName: "B", account: "222" })];

    const { merged, addedCount } = mergeCampaignRows(collected, incoming);

    assert.equal(addedCount, 0);
    assert.equal(merged.length, 2);
  });

  it("does not duplicate rows even if the same row appears twice in one incoming batch", () => {
    const incoming = [makeCampaignRow({ campaignName: "A" }), makeCampaignRow({ campaignName: "A" })];
    const { merged, addedCount } = mergeCampaignRows([], incoming);
    assert.equal(addedCount, 1);
    assert.equal(merged.length, 1);
  });
});
