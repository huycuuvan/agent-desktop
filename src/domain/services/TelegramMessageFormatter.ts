import type { CampaignChange, CampaignDiffSummary } from "../entities/CampaignDiff.js";

export interface TelegramNotificationInput {
  providerCode: string;
  runId: number;
  accounts: number;
  campaigns: number;
  summary: CampaignDiffSummary;
  changes: CampaignChange[];
}

const MAX_DETAIL_ITEMS = 10;

/**
 * Builds the Telegram alert text for a run's diff, or returns null when there
 * are no changes to report — callers must not send a message in that case.
 */
export function formatTelegramMessage(input: TelegramNotificationInput): string | null {
  const { providerCode, runId, accounts, campaigns, summary, changes } = input;

  if (changes.length === 0) {
    return null;
  }

  const lines: string[] = [
    `🚨 Google Ads Update - ${providerCode}`,
    "",
    `Run: #${runId}`,
    `Accounts: ${accounts}`,
    `Campaigns: ${campaigns}`,
    "",
    "Changes:",
    `- Status changed: ${summary.statusChanged}`,
    `- Budget changed: ${summary.budgetChanged}`,
    `- Cost changed: ${summary.costChanged}`,
    `- Metric changed: ${summary.metricChanged}`,
    `- New campaigns: ${summary.newCampaigns}`,
    `- Removed campaigns: ${summary.removedCampaigns}`,
    "",
    "Details:",
  ];

  const shown = changes.slice(0, MAX_DETAIL_ITEMS);
  shown.forEach((change, index) => {
    if (index > 0) {
      lines.push("");
    }
    lines.push(`${index + 1}. ${change.type}`);
    lines.push(`Campaign: ${change.campaignName ?? "—"}`);
    if (change.account) {
      lines.push(`Account: ${change.account}`);
    } else if (change.customerId) {
      lines.push(`Customer: ${change.customerId}`);
    }
    if (change.before !== null || change.after !== null) {
      lines.push(`Before: ${change.before ?? "—"}`);
      lines.push(`After: ${change.after ?? "—"}`);
    }
  });

  const remaining = changes.length - shown.length;
  if (remaining > 0) {
    lines.push("");
    lines.push(`...and ${remaining} more changes`);
  }

  return lines.join("\n");
}
