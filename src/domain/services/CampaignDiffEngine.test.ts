import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareCampaignSnapshots } from "./CampaignDiffEngine.js";
import type { FlatCampaignSnapshot } from "../entities/CampaignDiff.js";

function makeCampaign(overrides: Partial<FlatCampaignSnapshot> = {}): FlatCampaignSnapshot {
  return {
    campaignKey: "8361137753|NQT-MOMO-QKA-PG3-2906|727-700-2311",
    campaignName: "NQT-MOMO-QKA-PG3-2906",
    account: "727-700-2311",
    customerId: "8361137753",
    status: "Eligible",
    budget: "$5,000.00/day",
    cost: "$0.00",
    impressions: "0",
    interactions: "0",
    conversions: "0.00",
    ...overrides,
  };
}

describe("compareCampaignSnapshots", () => {
  it("reports a new campaign present in latest but not previous", () => {
    const latest = [makeCampaign()];
    const { summary, changes } = compareCampaignSnapshots([], latest);

    assert.equal(summary.newCampaigns, 1);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      type: "NEW_CAMPAIGN",
      campaignKey: latest[0]!.campaignKey,
      campaignName: latest[0]!.campaignName,
      account: latest[0]!.account,
      customerId: latest[0]!.customerId,
      before: null,
      after: null,
    });
  });

  it("reports a removed campaign present in previous but not latest", () => {
    const previous = [makeCampaign()];
    const { summary, changes } = compareCampaignSnapshots(previous, []);

    assert.equal(summary.removedCampaigns, 1);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      type: "REMOVED_CAMPAIGN",
      campaignKey: previous[0]!.campaignKey,
      campaignName: previous[0]!.campaignName,
      account: previous[0]!.account,
      customerId: previous[0]!.customerId,
      before: null,
      after: null,
    });
  });

  it("reports a status change for the same campaignKey", () => {
    const previous = [makeCampaign({ status: "Eligible" })];
    const latest = [makeCampaign({ status: "Paused" })];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.equal(summary.statusChanged, 1);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.type, "STATUS_CHANGED");
    assert.equal(changes[0]!.before, "Eligible");
    assert.equal(changes[0]!.after, "Paused");
  });

  it("reports a budget change for the same campaignKey", () => {
    const previous = [makeCampaign({ budget: "$5,000.00/day" })];
    const latest = [makeCampaign({ budget: "$6,000.00/day" })];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.equal(summary.budgetChanged, 1);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.type, "BUDGET_CHANGED");
    assert.equal(changes[0]!.before, "$5,000.00/day");
    assert.equal(changes[0]!.after, "$6,000.00/day");
  });

  it("reports a cost change for the same campaignKey", () => {
    const previous = [makeCampaign({ cost: "$0.00" })];
    const latest = [makeCampaign({ cost: "$12.50" })];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.equal(summary.costChanged, 1);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.type, "COST_CHANGED");
    assert.equal(changes[0]!.before, "$0.00");
    assert.equal(changes[0]!.after, "$12.50");
  });

  it("reports a metric change when impressions, interactions, or conversions differ", () => {
    const previous = [makeCampaign({ impressions: "0", interactions: "0", conversions: "0.00" })];
    const latest = [makeCampaign({ impressions: "100", interactions: "5", conversions: "1.00" })];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.equal(summary.metricChanged, 1);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.type, "METRIC_CHANGED");
    assert.deepEqual(JSON.parse(changes[0]!.before ?? "{}"), { impressions: "0", interactions: "0", conversions: "0.00" });
    assert.deepEqual(JSON.parse(changes[0]!.after ?? "{}"), { impressions: "100", interactions: "5", conversions: "1.00" });
  });

  it("returns an empty diff when nothing changed", () => {
    const previous = [makeCampaign()];
    const latest = [makeCampaign()];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.deepEqual(summary, {
      newCampaigns: 0,
      removedCampaigns: 0,
      statusChanged: 0,
      budgetChanged: 0,
      costChanged: 0,
      metricChanged: 0,
    });
    assert.equal(changes.length, 0);
  });

  it("can report multiple change types for the same campaign in one diff", () => {
    const previous = [makeCampaign({ status: "Eligible", budget: "$5,000.00/day", cost: "$0.00" })];
    const latest = [makeCampaign({ status: "Paused", budget: "$6,000.00/day", cost: "$10.00" })];
    const { summary, changes } = compareCampaignSnapshots(previous, latest);

    assert.equal(summary.statusChanged, 1);
    assert.equal(summary.budgetChanged, 1);
    assert.equal(summary.costChanged, 1);
    assert.equal(changes.length, 3);
  });
});
