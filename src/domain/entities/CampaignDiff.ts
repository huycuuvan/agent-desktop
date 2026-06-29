export type CampaignChangeType =
  | "NEW_CAMPAIGN"
  | "REMOVED_CAMPAIGN"
  | "STATUS_CHANGED"
  | "BUDGET_CHANGED"
  | "COST_CHANGED"
  | "METRIC_CHANGED";

export interface CampaignChange {
  type: CampaignChangeType;
  campaignKey: string;
  campaignName: string | null;
  account: string | null;
  customerId: string | null;
  before: string | null;
  after: string | null;
}

export interface CampaignDiffSummary {
  newCampaigns: number;
  removedCampaigns: number;
  statusChanged: number;
  budgetChanged: number;
  costChanged: number;
  metricChanged: number;
}

export interface CampaignDiffResult {
  summary: CampaignDiffSummary;
  changes: CampaignChange[];
}

export interface FlatCampaignSnapshot {
  campaignKey: string;
  campaignName: string | null;
  account: string | null;
  customerId: string | null;
  status: string | null;
  budget: string | null;
  cost: string | null;
  impressions: string | null;
  interactions: string | null;
  conversions: string | null;
}

export interface RunWithCampaigns {
  runId: number;
  providerCode: string;
  dateMode: string;
  fromDate: string | null;
  toDate: string | null;
  campaigns: FlatCampaignSnapshot[];
}
