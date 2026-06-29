import type { AdsPowerProfile } from "./AdsPowerProfile.js";
import type { BrowserTab } from "./BrowserTab.js";

export interface ProfileWithTabs {
  profile: AdsPowerProfile;
  tabs: BrowserTab[];
}
