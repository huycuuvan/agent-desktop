import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSearchingMessage,
  formatIntakeResultMessage,
  formatCollectingMessage,
  formatPipelineCompletedMessage,
  formatPipelineErrorMessage,
} from "./TelegramOrchestrationFormatter.js";
import type { GmailIntakeResult } from "../entities/GmailInvitation.js";
import type { PipelineRunSummary } from "../entities/PipelineRunSummary.js";
import type { CampaignDiffSummary } from "../entities/CampaignDiff.js";

const BASE_INTAKE: GmailIntakeResult = {
  status: "ALREADY_ACCEPTED",
  normalizedCustomerId: "362-758-7499",
  campaignsUrl: "https://ads.google.com/aw/campaigns?ocid=3627584999&workspaceId=0",
  campaignsPageReady: true,
};

const BASE_SUMMARY: PipelineRunSummary = {
  collectorRunId: 17,
  accounts: 3,
  campaigns: 5,
  failedAccounts: 0,
  sheetsAppendedRows: 0,
  sheetsUpdatedRows: 1,
  sheetsSkippedRows: 4,
  notificationStatus: null,
  notificationMessage: null,
  durationMs: 12345,
  status: "SUCCESS",
};

const BASE_DIFF: CampaignDiffSummary = {
  newCampaigns: 0,
  removedCampaigns: 0,
  statusChanged: 0,
  budgetChanged: 1,
  costChanged: 0,
  metricChanged: 0,
};

describe("formatSearchingMessage", () => {
  it("includes the customer id", () => {
    const msg = formatSearchingMessage("362-758-7499");
    assert.ok(msg.includes("362-758-7499"));
    assert.ok(msg.toLowerCase().includes("searching"));
  });
});

describe("formatCollectingMessage", () => {
  it("mentions collector / running", () => {
    const msg = formatCollectingMessage();
    assert.ok(msg.toLowerCase().includes("collector") || msg.toLowerCase().includes("running"));
  });
});

describe("formatIntakeResultMessage", () => {
  it("includes status", () => {
    const msg = formatIntakeResultMessage(BASE_INTAKE);
    assert.ok(msg.includes("ALREADY_ACCEPTED"));
  });

  it("includes campaignsPageReady when present", () => {
    const msg = formatIntakeResultMessage(BASE_INTAKE);
    assert.ok(msg.includes("true"));
  });

  it("includes reason when set", () => {
    const msg = formatIntakeResultMessage({ ...BASE_INTAKE, status: "FAILED", reason: "SOME_ERROR" });
    assert.ok(msg.includes("SOME_ERROR"));
  });

  it("omits campaignsPageReady when null", () => {
    const msg = formatIntakeResultMessage({ ...BASE_INTAKE, campaignsPageReady: null });
    assert.ok(!msg.includes("Campaigns page ready"));
  });
});

describe("formatPipelineCompletedMessage", () => {
  it("shows ✅ for SUCCESS", () => {
    const msg = formatPipelineCompletedMessage(BASE_SUMMARY, BASE_DIFF);
    assert.ok(msg.includes("✅"));
  });

  it("includes run id, accounts, campaigns, failed accounts", () => {
    const msg = formatPipelineCompletedMessage(BASE_SUMMARY, BASE_DIFF);
    assert.ok(msg.includes("#17"));
    assert.ok(msg.includes("Accounts: 3"));
    assert.ok(msg.includes("Campaigns: 5"));
    assert.ok(msg.includes("Failed accounts: 0"));
  });

  it("includes Sheets stats", () => {
    const msg = formatPipelineCompletedMessage(BASE_SUMMARY, BASE_DIFF);
    assert.ok(msg.includes("Appended: 0"));
    assert.ok(msg.includes("Updated: 1"));
    assert.ok(msg.includes("Skipped: 4"));
  });

  it("includes Diff stats when diff provided", () => {
    const msg = formatPipelineCompletedMessage(BASE_SUMMARY, BASE_DIFF);
    assert.ok(msg.includes("Budget changed: 1"));
    assert.ok(msg.includes("New: 0"));
    assert.ok(msg.includes("Removed: 0"));
  });

  it("omits Diff section when diff is null", () => {
    const msg = formatPipelineCompletedMessage(BASE_SUMMARY, null);
    assert.ok(!msg.includes("Diff:"));
  });

  it("shows non-success status label instead of ✅", () => {
    const msg = formatPipelineCompletedMessage({ ...BASE_SUMMARY, status: "SHEETS_FAILED" }, null);
    assert.ok(!msg.includes("✅"));
    assert.ok(msg.includes("SHEETS_FAILED"));
  });

  it("includes error field when set", () => {
    const msg = formatPipelineCompletedMessage(
      { ...BASE_SUMMARY, status: "COLLECTOR_FAILED", error: "AdsPower unreachable" },
      null,
    );
    assert.ok(msg.includes("AdsPower unreachable"));
  });
});

describe("formatPipelineErrorMessage", () => {
  it("shows ❌ and the error message", () => {
    const msg = formatPipelineErrorMessage("Connection refused");
    assert.ok(msg.includes("❌"));
    assert.ok(msg.includes("Connection refused"));
  });
});
