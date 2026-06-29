import type { AdsPowerProfile } from "../entities/AdsPowerProfile.js";
import type { GoogleAdsTab } from "../entities/GoogleAdsTab.js";
import type { GoogleAdsAccountReadResult } from "../entities/GoogleAdsAccountReadResult.js";
import type { GoogleAdsDateMode } from "../entities/GoogleAdsDateMode.js";
import type { GoogleAdsCampaignCollector } from "../repositories/GoogleAdsCampaignCollector.js";

export class CollectGoogleAdsCampaignsUseCase {
  constructor(private readonly collector: GoogleAdsCampaignCollector) {}

  async execute(
    profile: AdsPowerProfile,
    googleAdsTabs: GoogleAdsTab[],
    keyword: string,
    dateMode: GoogleAdsDateMode,
  ): Promise<GoogleAdsAccountReadResult[]> {
    const results: GoogleAdsAccountReadResult[] = [];

    for (const tab of googleAdsTabs) {
      try {
        results.push(await this.collector.collect(profile, tab, keyword, dateMode));
      } catch {
        results.push({
          accountName: tab.accountName,
          customerId: tab.customerId,
          keyword,
          dateMode,
          googleAdsDateLabel: null,
          fromDate: null,
          toDate: null,
          refreshed: false,
          filterChipFound: false,
          visibleRowCount: 0,
          paginationText: null,
          totalFilteredRows: 0,
          campaignsCollected: 0,
          campaignsMissing: 0,
          campaigns: [],
          reason: "COLLECT_FAILED",
        });
      }
    }

    return results;
  }
}
