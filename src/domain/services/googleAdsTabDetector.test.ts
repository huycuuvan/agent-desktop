import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectGoogleAdsTabs } from "./googleAdsTabDetector.js";
import type { BrowserTab } from "../entities/BrowserTab.js";

describe("detectGoogleAdsTabs", () => {
  it("filters out non Google Ads tabs and preserves tab index", () => {
    const tabs: BrowserTab[] = [
      { title: "Inbox - Gmail", url: "https://mail.google.com/mail/u/0/" },
      { title: "Sheet1 - Google Sheets", url: "https://docs.google.com/spreadsheets/d/123" },
      {
        title: "Campaigns - XOY SCAN - Google Ads",
        url: "https://ads.google.com/aw/campaigns?ocid=8361137753&workspaceId=0&euid=6494282148&__u=1876683652&uscid=8361137753&__c=7806617297&authuser=0&ascid=8361137753",
      },
    ];

    const result = detectGoogleAdsTabs("k1bv7956", tabs);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      profileId: "k1bv7956",
      tabIndex: 2,
      title: "Campaigns - XOY SCAN - Google Ads",
      url: tabs[2]!.url,
      accountName: "XOY SCAN",
      customerId: "8361137753",
      query: {
        ocid: "8361137753",
        uscid: "8361137753",
        ascid: "8361137753",
        __c: "7806617297",
        __u: "1876683652",
      },
    });
  });

  it("returns an empty array when there are no Google Ads tabs", () => {
    const tabs: BrowserTab[] = [{ title: "Inbox - Gmail", url: "https://mail.google.com/mail/u/0/" }];
    assert.deepEqual(detectGoogleAdsTabs("p1", tabs), []);
  });
});
