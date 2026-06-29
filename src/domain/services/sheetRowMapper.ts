import type { SheetSyncCampaign } from "../entities/SheetSync.js";

export const SHEET_COLUMNS = [
  "providerCode",
  "dateMode",
  "fromDate",
  "toDate",
  "customerId",
  "accountName",
  "campaignKey",
  "campaignName",
  "account",
  "budget",
  "status",
  "campaignType",
  "impressions",
  "interactions",
  "interactionRate",
  "avgCost",
  "cost",
  "conversions",
  "lastSeenRunId",
  "lastSeenAt",
] as const;

export interface SheetRowValues {
  campaignKey: string;
  values: string[];
}

export function buildSheetRowValues(campaign: SheetSyncCampaign, runId: number, lastSeenAt: string): string[] {
  return [
    campaign.providerCode,
    campaign.dateMode,
    campaign.fromDate ?? "",
    campaign.toDate ?? "",
    campaign.customerId ?? "",
    campaign.accountName ?? "",
    campaign.campaignKey,
    campaign.campaignName ?? "",
    campaign.account ?? "",
    campaign.budget ?? "",
    campaign.status ?? "",
    campaign.campaignType ?? "",
    campaign.impressions ?? "",
    campaign.interactions ?? "",
    campaign.interactionRate ?? "",
    campaign.avgCost ?? "",
    campaign.cost ?? "",
    campaign.conversions ?? "",
    String(runId),
    lastSeenAt,
  ];
}

export function buildSheetRows(campaigns: SheetSyncCampaign[], runId: number, lastSeenAt: string): SheetRowValues[] {
  return campaigns.map((campaign) => ({
    campaignKey: campaign.campaignKey,
    values: buildSheetRowValues(campaign, runId, lastSeenAt),
  }));
}
