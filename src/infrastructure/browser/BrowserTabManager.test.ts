import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTabUrl, extractCustomerIdFromUrl } from "./BrowserTabManager.js";

describe("classifyTabUrl", () => {
  it("classifies Gmail", () => {
    assert.equal(classifyTabUrl("https://mail.google.com/mail/u/0/", ""), "GMAIL");
  });

  it("classifies Google Sheets", () => {
    assert.equal(
      classifyTabUrl("https://docs.google.com/spreadsheets/d/abc123/edit", ""),
      "GOOGLE_SHEETS",
    );
  });

  it("classifies Google Ads campaigns page", () => {
    assert.equal(
      classifyTabUrl("https://ads.google.com/aw/campaigns?ocid=123456", ""),
      "GOOGLE_ADS_CAMPAIGNS",
    );
  });

  it("classifies Google Ads campaigns overview", () => {
    assert.equal(
      classifyTabUrl("https://ads.google.com/aw/overview?__c=789", ""),
      "GOOGLE_ADS_CAMPAIGNS",
    );
  });

  it("classifies Google Ads accept page with ivid param", () => {
    assert.equal(
      classifyTabUrl(
        "https://ads.google.com/nav/startacceptinvite?ivid=123&ocid=456",
        "",
      ),
      "GOOGLE_ADS_ACCEPT",
    );
  });

  it("classifies Google Ads accept page by path", () => {
    assert.equal(
      classifyTabUrl("https://ads.google.com/nav/acceptinvite?token=abc", ""),
      "GOOGLE_ADS_ACCEPT",
    );
  });

  it("classifies blank tabs", () => {
    assert.equal(classifyTabUrl("about:blank", ""), "BLANK");
    assert.equal(classifyTabUrl("chrome://newtab/", ""), "BLANK");
    assert.equal(classifyTabUrl("", ""), "BLANK");
  });

  it("classifies chrome-internal tabs", () => {
    assert.equal(classifyTabUrl("chrome://settings/", ""), "CHROME_INTERNAL");
    assert.equal(classifyTabUrl("chrome-extension://abc/popup.html", ""), "CHROME_INTERNAL");
  });

  it("classifies unknown URLs as OTHER", () => {
    assert.equal(classifyTabUrl("https://example.com", ""), "OTHER");
  });
});

describe("extractCustomerIdFromUrl", () => {
  it("extracts ocid", () => {
    assert.equal(
      extractCustomerIdFromUrl("https://ads.google.com/aw/campaigns?ocid=8357912352"),
      "8357912352",
    );
  });

  it("extracts __c when no ocid", () => {
    assert.equal(
      extractCustomerIdFromUrl("https://ads.google.com/aw/campaigns?__c=5377061556"),
      "5377061556",
    );
  });

  it("prefers ocid over __c", () => {
    assert.equal(
      extractCustomerIdFromUrl(
        "https://ads.google.com/aw/campaigns?ocid=111&__c=222",
      ),
      "111",
    );
  });

  it("returns undefined for non-matching URL", () => {
    assert.equal(
      extractCustomerIdFromUrl("https://ads.google.com/aw/campaigns"),
      undefined,
    );
  });

  it("returns undefined for invalid URL", () => {
    assert.equal(extractCustomerIdFromUrl("not a url"), undefined);
  });
});
