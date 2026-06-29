import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGoogleAdsUrl, parseAccountNameFromTitle, parseGoogleAdsUrl, resolveCustomerId } from "./googleAdsUrlParser.js";

describe("isGoogleAdsUrl", () => {
  it("returns true for ads.google.com URLs", () => {
    assert.equal(isGoogleAdsUrl("https://ads.google.com/aw/campaigns?ocid=123"), true);
  });

  it("returns false for non Google Ads hostnames", () => {
    assert.equal(isGoogleAdsUrl("https://docs.google.com/spreadsheets/d/123"), false);
    assert.equal(isGoogleAdsUrl("https://mail.google.com/mail/u/0/"), false);
  });

  it("returns false for invalid URLs", () => {
    assert.equal(isGoogleAdsUrl("not-a-url"), false);
    assert.equal(isGoogleAdsUrl(""), false);
  });
});

describe("parseGoogleAdsUrl", () => {
  it("extracts the known query params", () => {
    const url =
      "https://ads.google.com/aw/campaigns?ocid=8361137753&workspaceId=0&euid=6494282148&__u=1876683652&uscid=8361137753&__c=7806617297&authuser=0&ascid=8361137753";

    assert.deepEqual(parseGoogleAdsUrl(url), {
      ocid: "8361137753",
      uscid: "8361137753",
      ascid: "8361137753",
      __c: "7806617297",
      __u: "1876683652",
    });
  });

  it("omits params that are missing", () => {
    const url = "https://ads.google.com/aw/campaigns?ocid=8360759013";
    assert.deepEqual(parseGoogleAdsUrl(url), { ocid: "8360759013" });
  });

  it("returns an empty object for invalid URLs", () => {
    assert.deepEqual(parseGoogleAdsUrl("not-a-url"), {});
  });
});

describe("parseAccountNameFromTitle", () => {
  it("extracts the account name between page name and Google Ads suffix", () => {
    assert.equal(parseAccountNameFromTitle("Campaigns - XOY SCAN - Google Ads"), "XOY SCAN");
  });

  it("handles titles without a leading page name", () => {
    assert.equal(parseAccountNameFromTitle("XOY SCAN - Google Ads"), "XOY SCAN");
  });

  it("handles account names containing a dash", () => {
    assert.equal(parseAccountNameFromTitle("Campaigns - AN CO - Google Ads"), "AN CO");
  });

  it("returns undefined when there is nothing left after stripping the suffix", () => {
    assert.equal(parseAccountNameFromTitle("Google Ads"), undefined);
  });

  it("returns undefined for an empty title", () => {
    assert.equal(parseAccountNameFromTitle(""), undefined);
  });
});

describe("resolveCustomerId", () => {
  it("prioritizes ocid over the other ids", () => {
    assert.equal(
      resolveCustomerId({ ocid: "1", uscid: "2", ascid: "3", __c: "4" }),
      "1",
    );
  });

  it("falls back to uscid when ocid is missing", () => {
    assert.equal(resolveCustomerId({ uscid: "2", ascid: "3", __c: "4" }), "2");
  });

  it("falls back to ascid when ocid and uscid are missing", () => {
    assert.equal(resolveCustomerId({ ascid: "3", __c: "4" }), "3");
  });

  it("falls back to __c when only it is present", () => {
    assert.equal(resolveCustomerId({ __c: "4" }), "4");
  });

  it("returns undefined when no relevant ids are present", () => {
    assert.equal(resolveCustomerId({ __u: "5" }), undefined);
  });
});
