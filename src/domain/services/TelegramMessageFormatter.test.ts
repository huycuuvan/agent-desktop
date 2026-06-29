import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTelegramMessage } from "./TelegramMessageFormatter.js";
import type { CampaignChange, CampaignDiffSummary } from "../entities/CampaignDiff.js";

function makeSummary(overrides: Partial<CampaignDiffSummary> = {}): CampaignDiffSummary {
  return {
    newCampaigns: 0,
    removedCampaigns: 0,
    statusChanged: 0,
    budgetChanged: 0,
    costChanged: 0,
    metricChanged: 0,
    ...overrides,
  };
}

function makeChange(overrides: Partial<CampaignChange> = {}): CampaignChange {
  return {
    type: "STATUS_CHANGED",
    campaignKey: "8363828102|Camp|727-700-2311",
    campaignName: "Camp",
    account: "727-700-2311",
    customerId: "8363828102",
    before: "Paused",
    after: "Eligible",
    ...overrides,
  };
}

describe("formatTelegramMessage", () => {
  it("matches the documented message format exactly", () => {
    const message = formatTelegramMessage({
      providerCode: "QKA",
      runId: 12,
      accounts: 2,
      campaigns: 5,
      summary: makeSummary({ statusChanged: 1, costChanged: 1, metricChanged: 1 }),
      changes: [
        makeChange({
          type: "STATUS_CHANGED",
          campaignName: "NQT-MOMO-QKA-PG3-2906 #2",
          account: "727-700-2311",
          customerId: "8363828102",
          before: "Paused",
          after: "Eligible",
        }),
        makeChange({
          type: "COST_CHANGED",
          campaignName: "GG-ALEX-QKA-NGN-3006 HOTZ 1.1",
          account: null,
          customerId: "8357912352",
          before: "IDR0",
          after: "IDR42,627",
        }),
      ],
    });

    assert.equal(
      message,
      [
        "🚨 Google Ads Update - QKA",
        "",
        "Run: #12",
        "Accounts: 2",
        "Campaigns: 5",
        "",
        "Changes:",
        "- Status changed: 1",
        "- Budget changed: 0",
        "- Cost changed: 1",
        "- Metric changed: 1",
        "- New campaigns: 0",
        "- Removed campaigns: 0",
        "",
        "Details:",
        "1. STATUS_CHANGED",
        "Campaign: NQT-MOMO-QKA-PG3-2906 #2",
        "Account: 727-700-2311",
        "Before: Paused",
        "After: Eligible",
        "",
        "2. COST_CHANGED",
        "Campaign: GG-ALEX-QKA-NGN-3006 HOTZ 1.1",
        "Customer: 8357912352",
        "Before: IDR0",
        "After: IDR42,627",
      ].join("\n"),
    );
  });

  it("returns null when there are no changes — caller must not send a message", () => {
    const message = formatTelegramMessage({
      providerCode: "QKA",
      runId: 12,
      accounts: 2,
      campaigns: 5,
      summary: makeSummary(),
      changes: [],
    });

    assert.equal(message, null);
  });

  it("caps detail items at 10 and appends a '...and N more changes' line", () => {
    const changes: CampaignChange[] = Array.from({ length: 15 }, (_, index) =>
      makeChange({ campaignKey: `key-${index}`, campaignName: `Camp ${index}` }),
    );

    const message = formatTelegramMessage({
      providerCode: "QKA",
      runId: 1,
      accounts: 1,
      campaigns: 15,
      summary: makeSummary({ statusChanged: 15 }),
      changes,
    });

    assert.ok(message);
    const detailHeaders = message!.match(/^\d+\. STATUS_CHANGED$/gm) ?? [];
    assert.equal(detailHeaders.length, 10);
    assert.match(message!, /\.\.\.and 5 more changes/);
    assert.ok(!message!.includes("Camp 10"));
    assert.ok(message!.includes("Camp 9"));
  });

  it("shows Account when present, falling back to Customer when account is null", () => {
    const withAccount = formatTelegramMessage({
      providerCode: "QKA",
      runId: 1,
      accounts: 1,
      campaigns: 1,
      summary: makeSummary({ statusChanged: 1 }),
      changes: [makeChange({ account: "111-111-1111", customerId: "999" })],
    });
    assert.match(withAccount!, /Account: 111-111-1111/);
    assert.ok(!withAccount!.includes("Customer:"));

    const withoutAccount = formatTelegramMessage({
      providerCode: "QKA",
      runId: 1,
      accounts: 1,
      campaigns: 1,
      summary: makeSummary({ statusChanged: 1 }),
      changes: [makeChange({ account: null, customerId: "999" })],
    });
    assert.match(withoutAccount!, /Customer: 999/);
    assert.ok(!withoutAccount!.includes("Account:"));
  });

  it("omits Before/After lines for NEW_CAMPAIGN/REMOVED_CAMPAIGN where both are null", () => {
    const message = formatTelegramMessage({
      providerCode: "QKA",
      runId: 1,
      accounts: 1,
      campaigns: 1,
      summary: makeSummary({ newCampaigns: 1 }),
      changes: [makeChange({ type: "NEW_CAMPAIGN", before: null, after: null })],
    });

    assert.ok(!message!.includes("Before:"));
    assert.ok(!message!.includes("After:"));
  });
});
