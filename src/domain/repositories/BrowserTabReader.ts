import type { AdsPowerProfile } from "../entities/AdsPowerProfile.js";
import type { BrowserTab } from "../entities/BrowserTab.js";

export interface BrowserTabReader {
  listOpenTabs(profile: AdsPowerProfile): Promise<BrowserTab[]>;
}
