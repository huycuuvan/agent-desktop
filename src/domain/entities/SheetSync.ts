export interface SheetSyncCampaign {
  campaignKey: string;
  campaignName: string | null;
  account: string | null;
  customerId: string | null;
  accountName: string | null;
  providerCode: string;
  dateMode: string;
  fromDate: string | null;
  toDate: string | null;
  budget: string | null;
  status: string | null;
  campaignType: string | null;
  impressions: string | null;
  interactions: string | null;
  interactionRate: string | null;
  avgCost: string | null;
  cost: string | null;
  conversions: string | null;
}

export interface LatestRunForSheetsSync {
  runId: number;
  campaigns: SheetSyncCampaign[];
}
