import type { GoogleAdsAccountReadResult } from "../entities/GoogleAdsAccountReadResult.js";
import type { GoogleAdsDateMode } from "../entities/GoogleAdsDateMode.js";
import type { AccountSnapshotInput, CollectorRunInput } from "../entities/CollectorRunSnapshot.js";
import { buildCampaignKey } from "./campaignKeyBuilder.js";

export function mapAccountResultToSnapshotInput(result: GoogleAdsAccountReadResult): AccountSnapshotInput {
  return {
    accountName: result.accountName ?? null,
    customerId: result.customerId ?? null,
    keyword: result.keyword,
    refreshed: result.refreshed,
    filterChipFound: result.filterChipFound,
    visibleRowCount: result.visibleRowCount,
    totalFilteredRows: result.totalFilteredRows,
    campaignsCollected: result.campaignsCollected,
    campaignsMissing: result.campaignsMissing,
    reason: result.reason ?? null,
    screenshotPath: result.screenshotPath ?? null,
    fromDate: result.fromDate,
    toDate: result.toDate,
    googleAdsDateLabel: result.googleAdsDateLabel,
    campaigns: result.campaigns.map((row) => ({
      campaignKey: buildCampaignKey(result.customerId, row),
      campaignName: row.campaignName,
      budget: row.budget,
      status: row.status,
      optimizationScore: row.optimizationScore,
      account: row.account,
      campaignType: row.campaignType,
      impressions: row.impressions,
      interactions: row.interactions,
      interactionRate: row.interactionRate,
      avgCost: row.avgCost,
      cost: row.cost,
      conversions: row.conversions,
    })),
  };
}

export function buildCollectorRunInput(
  startedAt: Date,
  finishedAt: Date,
  status: string,
  providerCode: string,
  dateMode: GoogleAdsDateMode,
  results: GoogleAdsAccountReadResult[],
): CollectorRunInput {
  return {
    startedAt,
    finishedAt,
    status,
    providerCode,
    dateMode,
    rawJson: JSON.stringify(results),
    accounts: results.map(mapAccountResultToSnapshotInput),
  };
}
