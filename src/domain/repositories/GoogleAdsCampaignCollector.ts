import type { AdsPowerProfile } from "../entities/AdsPowerProfile.js";
import type { GoogleAdsTab } from "../entities/GoogleAdsTab.js";
import type { GoogleAdsAccountReadResult } from "../entities/GoogleAdsAccountReadResult.js";
import type { GoogleAdsDateMode } from "../entities/GoogleAdsDateMode.js";

export interface GoogleAdsCampaignCollector {
  collect(profile: AdsPowerProfile, tab: GoogleAdsTab, keyword: string, dateMode: GoogleAdsDateMode): Promise<GoogleAdsAccountReadResult>;
}
