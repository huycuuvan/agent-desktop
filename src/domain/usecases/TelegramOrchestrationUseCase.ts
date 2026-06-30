import type { GmailIntakeUseCase } from "./GmailIntakeUseCase.js";
import type { PipelineRunSummary } from "../entities/PipelineRunSummary.js";

/** Structural interface so tests can pass lightweight stubs without a full `AgentPipelineUseCase`. */
export interface PipelineRunner {
  run(dryRun: boolean): Promise<PipelineRunSummary>;
}
import type { SnapshotRepository } from "../repositories/SnapshotRepository.js";
import type { GmailIntakeResult, GmailIntakeStatus } from "../entities/GmailInvitation.js";
import type { CampaignDiffSummary } from "../entities/CampaignDiff.js";
import { compareCampaignSnapshots } from "../services/CampaignDiffEngine.js";

/** Statuses that count as "intake succeeded → proceed with pipeline". */
const INTAKE_SUCCESS_STATUSES: ReadonlySet<GmailIntakeStatus> = new Set([
  "ACCEPTED",
  "ALREADY_ACCEPTED",
]);

export type OrchestrationOutcome =
  | "ORCHESTRATION_DISABLED" // feature flag off — intake ran, pipeline skipped
  | "INTAKE_FAILED"          // intake returned a non-success status — pipeline not started
  | "PIPELINE_COMPLETED"     // intake succeeded + pipeline ran (may still have SHEETS_FAILED etc.)
  | "PIPELINE_ERROR";        // intake succeeded but pipeline threw unexpectedly

export interface OrchestrationResult {
  outcome: OrchestrationOutcome;
  intakeResult: GmailIntakeResult;
  pipelineResult: PipelineRunSummary | null;
  diffSummary: CampaignDiffSummary | null;
  pipelineError: string | null;
}

export interface OrchestrationProgressSink {
  /** Called immediately after the intake step completes (before the pipeline runs). */
  onIntakeComplete(result: GmailIntakeResult): Promise<void>;
  /** Called just before the collector pipeline starts. */
  onPipelineStart(): Promise<void>;
}

export class TelegramOrchestrationUseCase {
  constructor(
    private readonly gmailIntake: GmailIntakeUseCase,
    private readonly pipeline: PipelineRunner,
    private readonly snapshotRepository: SnapshotRepository,
    private readonly orchestrationEnabled: boolean,
  ) {}

  async run(
    customerId: string,
    source: string,
    onProgress?: Partial<OrchestrationProgressSink>,
  ): Promise<OrchestrationResult> {
    // Step 1: Gmail intake
    const intakeResult = await this.gmailIntake.acceptInvitation(customerId, source);

    // Notify about intake result (fire-and-forget style — a send failure must not abort the flow)
    await onProgress?.onIntakeComplete?.(intakeResult).catch(() => undefined);

    // If the orchestration feature is disabled, stop here (Phase 6 behavior preserved)
    if (!this.orchestrationEnabled) {
      return {
        outcome: "ORCHESTRATION_DISABLED",
        intakeResult,
        pipelineResult: null,
        diffSummary: null,
        pipelineError: null,
      };
    }

    // Only continue if intake succeeded
    if (!INTAKE_SUCCESS_STATUSES.has(intakeResult.status)) {
      return {
        outcome: "INTAKE_FAILED",
        intakeResult,
        pipelineResult: null,
        diffSummary: null,
        pipelineError: null,
      };
    }

    // Step 2: Pipeline (Collector → Snapshot → Sheets Sync)
    await onProgress?.onPipelineStart?.().catch(() => undefined);

    let pipelineResult: PipelineRunSummary;
    try {
      pipelineResult = await this.pipeline.run(false);
    } catch (error) {
      const pipelineError = error instanceof Error ? error.message : String(error);
      return {
        outcome: "PIPELINE_ERROR",
        intakeResult,
        pipelineResult: null,
        diffSummary: null,
        pipelineError,
      };
    }

    // Step 3: Compute diff for the summary message
    const diffSummary = await this.computeLatestDiff();

    return {
      outcome: "PIPELINE_COMPLETED",
      intakeResult,
      pipelineResult,
      diffSummary,
      pipelineError: null,
    };
  }

  private async computeLatestDiff(): Promise<CampaignDiffSummary | null> {
    try {
      const latest = await this.snapshotRepository.getLatestRunWithCampaigns();
      if (!latest) return null;

      const previous = await this.snapshotRepository.getLatestComparableRun(latest);
      if (!previous) return null;

      const { summary } = compareCampaignSnapshots(previous.campaigns, latest.campaigns);
      return summary;
    } catch {
      return null;
    }
  }
}
