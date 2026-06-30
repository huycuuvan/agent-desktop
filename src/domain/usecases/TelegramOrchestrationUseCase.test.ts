import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TelegramOrchestrationUseCase, type PipelineRunner } from "./TelegramOrchestrationUseCase.js";
import type { GmailIntakeUseCase } from "./GmailIntakeUseCase.js";
import type { SnapshotRepository } from "../repositories/SnapshotRepository.js";
import type { GmailIntakeResult } from "../entities/GmailInvitation.js";
import type { PipelineRunSummary } from "../entities/PipelineRunSummary.js";

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makeIntake(result: GmailIntakeResult): Pick<GmailIntakeUseCase, "acceptInvitation" | "search"> {
  return {
    acceptInvitation: async () => result,
    search: async () => result,
  };
}

function makePipeline(summary: PipelineRunSummary): PipelineRunner {
  return { run: async () => summary };
}

function makeThrowingPipeline(msg: string): PipelineRunner {
  return {
    run: async () => {
      throw new Error(msg);
    },
  };
}

const EMPTY_SNAPSHOT_REPO: SnapshotRepository = {
  saveRun: async () => 1,
  getLatestRunSummary: async () => null,
  getLatestRunWithCampaigns: async () => null,
  getLatestComparableRun: async () => null,
  getLatestRunForSheetsSync: async () => null,
};

const ACCEPTED_INTAKE: GmailIntakeResult = {
  status: "ACCEPTED",
  normalizedCustomerId: "362-758-7499",
  campaignsUrl: "https://ads.google.com/aw/campaigns?ocid=3627587499&workspaceId=0",
  campaignsPageReady: true,
};

const ALREADY_ACCEPTED_INTAKE: GmailIntakeResult = {
  status: "ALREADY_ACCEPTED",
  normalizedCustomerId: "362-758-7499",
  campaignsUrl: "https://ads.google.com/aw/campaigns?ocid=3627587499&workspaceId=0",
  campaignsPageReady: true,
};

const FAILED_INTAKE: GmailIntakeResult = {
  status: "NO_MATCH",
  normalizedCustomerId: "362-758-7499",
};

const SUCCESS_PIPELINE: PipelineRunSummary = {
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

const SHEETS_FAILED_PIPELINE: PipelineRunSummary = { ...SUCCESS_PIPELINE, status: "SHEETS_FAILED", error: "Sheets API error" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelegramOrchestrationUseCase — orchestration disabled", () => {
  it("returns ORCHESTRATION_DISABLED and does not call pipeline when flag=false", async () => {
    let pipelineCalled = false;
    const pipeline = { run: async () => { pipelineCalled = true; return SUCCESS_PIPELINE; } };

    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      pipeline,
      EMPTY_SNAPSHOT_REPO,
      false,
    );

    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "ORCHESTRATION_DISABLED");
    assert.deepEqual(result.intakeResult, ACCEPTED_INTAKE);
    assert.equal(result.pipelineResult, null);
    assert.equal(pipelineCalled, false);
  });
});

describe("TelegramOrchestrationUseCase — failed intake", () => {
  it("returns INTAKE_FAILED and does not call pipeline", async () => {
    let pipelineCalled = false;
    const pipeline = { run: async () => { pipelineCalled = true; return SUCCESS_PIPELINE; } };

    const uc = new TelegramOrchestrationUseCase(
      makeIntake(FAILED_INTAKE) as GmailIntakeUseCase,
      pipeline,
      EMPTY_SNAPSHOT_REPO,
      true,
    );

    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "INTAKE_FAILED");
    assert.equal(result.pipelineResult, null);
    assert.equal(pipelineCalled, false);
  });

  it("returns INTAKE_FAILED for all non-success statuses", async () => {
    for (const status of ["FAILED", "MANUAL_ACTION_REQUIRED", "EXPIRED_OR_CANCELLED", "GMAIL_TAB_NOT_FOUND", "GMAIL_SIGN_IN_REQUIRED", "MULTIPLE_MATCHES", "NO_MATCH"] as const) {
      const uc = new TelegramOrchestrationUseCase(
        makeIntake({ status, normalizedCustomerId: "362-758-7499" }) as GmailIntakeUseCase,
        makePipeline(SUCCESS_PIPELINE),
        EMPTY_SNAPSHOT_REPO,
        true,
      );
      const result = await uc.run("362-758-7499", "test");
      assert.equal(result.outcome, "INTAKE_FAILED", `expected INTAKE_FAILED for status=${status}`);
    }
  });
});

describe("TelegramOrchestrationUseCase — successful intake triggers pipeline", () => {
  it("ACCEPTED → calls pipeline and returns PIPELINE_COMPLETED", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );
    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "PIPELINE_COMPLETED");
    assert.deepEqual(result.pipelineResult, SUCCESS_PIPELINE);
  });

  it("ALREADY_ACCEPTED → calls pipeline and returns PIPELINE_COMPLETED", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ALREADY_ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );
    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "PIPELINE_COMPLETED");
  });

  it("SHEETS_FAILED pipeline still returns PIPELINE_COMPLETED (not PIPELINE_ERROR)", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SHEETS_FAILED_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );
    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "PIPELINE_COMPLETED");
    assert.equal(result.pipelineResult?.status, "SHEETS_FAILED");
  });
});

describe("TelegramOrchestrationUseCase — pipeline throws", () => {
  it("returns PIPELINE_ERROR with the error message", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makeThrowingPipeline("AdsPower unreachable"),
      EMPTY_SNAPSHOT_REPO,
      true,
    );
    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "PIPELINE_ERROR");
    assert.ok(result.pipelineError?.includes("AdsPower unreachable"));
    assert.equal(result.pipelineResult, null);
  });
});

describe("TelegramOrchestrationUseCase — progress callbacks", () => {
  it("calls onIntakeComplete then onPipelineStart in order", async () => {
    const events: string[] = [];

    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );

    await uc.run("362-758-7499", "test", {
      onIntakeComplete: async () => { events.push("intake"); },
      onPipelineStart: async () => { events.push("pipeline"); },
    });

    assert.deepEqual(events, ["intake", "pipeline"]);
  });

  it("does not call onPipelineStart when intake fails", async () => {
    const events: string[] = [];

    const uc = new TelegramOrchestrationUseCase(
      makeIntake(FAILED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );

    await uc.run("362-758-7499", "test", {
      onIntakeComplete: async () => { events.push("intake"); },
      onPipelineStart: async () => { events.push("pipeline"); },
    });

    assert.deepEqual(events, ["intake"]);
  });

  it("callback errors do not abort the orchestration", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );

    const result = await uc.run("362-758-7499", "test", {
      onIntakeComplete: async () => { throw new Error("Telegram send failed"); },
      onPipelineStart: async () => { throw new Error("Telegram send failed"); },
    });

    // Orchestration should still complete despite callback errors
    assert.equal(result.outcome, "PIPELINE_COMPLETED");
  });
});

describe("TelegramOrchestrationUseCase — diff computation", () => {
  it("returns null diffSummary when snapshot repo has no comparable run", async () => {
    const uc = new TelegramOrchestrationUseCase(
      makeIntake(ACCEPTED_INTAKE) as GmailIntakeUseCase,
      makePipeline(SUCCESS_PIPELINE),
      EMPTY_SNAPSHOT_REPO,
      true,
    );
    const result = await uc.run("362-758-7499", "test");
    assert.equal(result.outcome, "PIPELINE_COMPLETED");
    assert.equal(result.diffSummary, null);
  });
});
