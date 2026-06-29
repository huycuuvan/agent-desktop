import type { CampaignRow } from "./CampaignRow.js";
import type { GoogleAdsDateMode } from "./GoogleAdsDateMode.js";

export interface GoogleAdsAccountReadResult {
  accountName?: string;
  customerId?: string;
  keyword: string;
  dateMode: GoogleAdsDateMode;
  googleAdsDateLabel: string | null;
  fromDate: string | null;
  toDate: string | null;
  refreshed: boolean;
  filterChipFound: boolean;
  visibleRowCount: number;
  paginationText: string | null;
  totalFilteredRows: number;
  campaignsCollected: number;
  campaignsMissing: number;
  campaigns: CampaignRow[];
  screenshotPath?: string;
  reason?: string;
}
