import type { GmailIntakeResult } from "../entities/GmailInvitation.js";
import type { PipelineRunSummary } from "../entities/PipelineRunSummary.js";
import type { CampaignDiffSummary } from "../entities/CampaignDiff.js";

export function formatSearchingMessage(customerId: string): string {
  return `Searching for invitation: ${customerId}...`;
}

export function formatIntakeResultMessage(result: GmailIntakeResult): string {
  const lines: string[] = [`Invitation status: ${result.status}`];
  if (result.reason) lines.push(`Reason: ${result.reason}`);
  if (result.campaignsUrl) lines.push(`Campaigns: ${result.campaignsUrl}`);
  if (result.campaignsPageReady != null) {
    lines.push(`Campaigns page ready: ${result.campaignsPageReady}`);
  }
  return lines.join("\n");
}

export function formatCollectingMessage(): string {
  return "Running collector...";
}

export function formatPipelineCompletedMessage(
  summary: PipelineRunSummary,
  diff: CampaignDiffSummary | null,
): string {
  const isPipelineOk =
    summary.status === "SUCCESS" || summary.status === "SUCCESS_WITH_NOTIFICATION_ERROR";
  const header = isPipelineOk ? "Pipeline completed ✅" : `Pipeline ended with status: ${summary.status}`;

  const lines: string[] = [header, ""];

  if (summary.collectorRunId != null) lines.push(`Run: #${summary.collectorRunId}`);
  lines.push(`Accounts: ${summary.accounts}`);
  lines.push(`Campaigns: ${summary.campaigns}`);
  lines.push(`Failed accounts: ${summary.failedAccounts}`);

  lines.push("");
  lines.push("Sheets:");
  lines.push(`- Appended: ${summary.sheetsAppendedRows}`);
  lines.push(`- Updated: ${summary.sheetsUpdatedRows}`);
  lines.push(`- Skipped: ${summary.sheetsSkippedRows}`);

  if (diff) {
    lines.push("");
    lines.push("Diff:");
    lines.push(`- New: ${diff.newCampaigns}`);
    lines.push(`- Removed: ${diff.removedCampaigns}`);
    lines.push(`- Status changed: ${diff.statusChanged}`);
    lines.push(`- Budget changed: ${diff.budgetChanged}`);
    lines.push(`- Cost changed: ${diff.costChanged}`);
    lines.push(`- Metric changed: ${diff.metricChanged}`);
  }

  if (summary.error) {
    lines.push("");
    lines.push(`Error: ${summary.error}`);
  }

  return lines.join("\n");
}

export function formatPipelineErrorMessage(error: string): string {
  return `Pipeline failed ❌\n\nError: ${error}`;
}

export function formatOrchestrationDisabledMessage(intakeResult: GmailIntakeResult): string {
  return formatIntakeResultMessage(intakeResult);
}
