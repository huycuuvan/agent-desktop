export interface CampaignSnapshotInput {
  campaignKey: string;
  campaignName: string | null;
  budget: string | null;
  status: string | null;
  optimizationScore: string | null;
  account: string | null;
  campaignType: string | null;
  impressions: string | null;
  interactions: string | null;
  interactionRate: string | null;
  avgCost: string | null;
  cost: string | null;
  conversions: string | null;
}

export interface AccountSnapshotInput {
  accountName: string | null;
  customerId: string | null;
  keyword: string;
  refreshed: boolean;
  filterChipFound: boolean;
  visibleRowCount: number;
  totalFilteredRows: number;
  campaignsCollected: number;
  campaignsMissing: number;
  reason: string | null;
  screenshotPath: string | null;
  fromDate: string | null;
  toDate: string | null;
  googleAdsDateLabel: string | null;
  campaigns: CampaignSnapshotInput[];
}

export interface CollectorRunInput {
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  providerCode: string;
  dateMode: string;
  rawJson: string | null;
  accounts: AccountSnapshotInput[];
}

export interface CollectorRunSummary {
  runId: number;
  accountsCount: number;
  campaignsCount: number;
  failedAccountsCount: number;
}
