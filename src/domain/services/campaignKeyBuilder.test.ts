import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCampaignKey } from "./campaignKeyBuilder.js";
import type { CampaignRow } from "../entities/CampaignRow.js";

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
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

describe("buildCampaignKey", () => {
  it("combines customerId, campaignName, and account", () => {
    const key = buildCampaignKey("8361137753", makeRow());
    assert.equal(key, "8361137753|NQT-MOMO-QKA-PG3-2906|727-700-2311");
  });

  it("produces different keys when customerId, campaignName, or account differ", () => {
    const base = buildCampaignKey("8361137753", makeRow());
    const differentCustomer = buildCampaignKey("9999999999", makeRow());
    const differentName = buildCampaignKey("8361137753", makeRow({ campaignName: "Other" }));
    const differentAccount = buildCampaignKey("8361137753", makeRow({ account: "111-111-1111" }));

    assert.notEqual(base, differentCustomer);
    assert.notEqual(base, differentName);
    assert.notEqual(base, differentAccount);
  });

  it("tolerates missing customerId or null fields without throwing", () => {
    assert.equal(buildCampaignKey(null, makeRow({ campaignName: null, account: null })), "||");
    assert.equal(buildCampaignKey(undefined, makeRow({ campaignName: null, account: null })), "||");
  });
});
