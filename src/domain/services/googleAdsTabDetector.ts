import type { BrowserTab } from "../entities/BrowserTab.js";
import type { GoogleAdsTab } from "../entities/GoogleAdsTab.js";
import { isGoogleAdsUrl, parseAccountNameFromTitle, parseGoogleAdsUrl, resolveCustomerId } from "./googleAdsUrlParser.js";

export function detectGoogleAdsTabs(profileId: string, tabs: BrowserTab[]): GoogleAdsTab[] {
  const googleAdsTabs: GoogleAdsTab[] = [];

  tabs.forEach((tab, tabIndex) => {
    if (!isGoogleAdsUrl(tab.url)) {
      return;
    }

    const query = parseGoogleAdsUrl(tab.url);

    googleAdsTabs.push({
      profileId,
      tabIndex,
      title: tab.title,
      url: tab.url,
      accountName: parseAccountNameFromTitle(tab.title),
      customerId: resolveCustomerId(query),
      query,
    });
  });

  return googleAdsTabs;
}
