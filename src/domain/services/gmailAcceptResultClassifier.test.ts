import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyAcceptPage, extractCampaignsUrlFromAcceptPageUrl } from "./gmailAcceptResultClassifier.js";

describe("classifyAcceptPage — ALREADY_ACCEPTED", () => {
  it("classifies the exact evidence text", () => {
    const text =
      "This invitation has already been accepted. Sign in to Google Ads to access this account.";
    assert.equal(classifyAcceptPage(text, false), "ALREADY_ACCEPTED");
  });

  it("classifies 'invitation has already been accepted' variant", () => {
    assert.equal(classifyAcceptPage("The invitation has already been accepted.", false), "ALREADY_ACCEPTED");
  });

  it("classifies 'already been accepted' variant", () => {
    assert.equal(classifyAcceptPage("This request has already been accepted.", false), "ALREADY_ACCEPTED");
  });

  it("classifies as ALREADY_ACCEPTED even when a Sign In button is present (hasConfirmButton=true)", () => {
    const text =
      "This invitation has already been accepted. Sign in to Google Ads to access this account.";
    // The sign-in page may expose a confirm/sign-in button — ALREADY_ACCEPTED must still win.
    assert.equal(classifyAcceptPage(text, true), "ALREADY_ACCEPTED");
  });

  it("is case-insensitive", () => {
    assert.equal(classifyAcceptPage("ALREADY BEEN ACCEPTED", false), "ALREADY_ACCEPTED");
  });

  it("classifies 'this account has already been added'", () => {
    assert.equal(classifyAcceptPage("This account has already been added to your MCC.", false), "ALREADY_ACCEPTED");
  });
});

describe("classifyAcceptPage — SUCCESS", () => {
  it("classifies 'you now have access'", () => {
    assert.equal(classifyAcceptPage("You now have access to the account.", false), "SUCCESS");
  });

  it("classifies 'invitation accepted'", () => {
    assert.equal(classifyAcceptPage("Invitation accepted successfully.", false), "SUCCESS");
  });

  it("classifies 'account access confirmed'", () => {
    assert.equal(classifyAcceptPage("Account access confirmed.", false), "SUCCESS");
  });

  it("classifies 'you've been added'", () => {
    assert.equal(classifyAcceptPage("You've been added to the account.", false), "SUCCESS");
  });
});

describe("classifyAcceptPage — EXPIRED_OR_CANCELLED", () => {
  it("classifies 'expired'", () => {
    assert.equal(classifyAcceptPage("This invitation has expired.", false), "EXPIRED_OR_CANCELLED");
  });

  it("classifies 'cancelled'", () => {
    assert.equal(classifyAcceptPage("The invitation was cancelled.", false), "EXPIRED_OR_CANCELLED");
  });

  it("classifies 'no longer valid'", () => {
    assert.equal(classifyAcceptPage("This link is no longer valid.", false), "EXPIRED_OR_CANCELLED");
  });

  it("does NOT classify as EXPIRED when text says 'already been accepted' even if 'not available' also appears", () => {
    // Some already-accepted pages say the account/offer is "not available" for re-accept.
    // ALREADY_ACCEPTED must win because it is checked first.
    const text = "This invitation has already been accepted. This offer is no longer available.";
    assert.equal(classifyAcceptPage(text, false), "ALREADY_ACCEPTED");
  });
});

describe("classifyAcceptPage — NEEDS_CONFIRM / UNCLEAR", () => {
  it("classifies as NEEDS_CONFIRM when no keyword matches but a confirm button is present", () => {
    assert.equal(classifyAcceptPage("Please review the invitation details.", true), "NEEDS_CONFIRM");
  });

  it("classifies as UNCLEAR when no keyword matches and no confirm button", () => {
    assert.equal(classifyAcceptPage("An error occurred. Please try again.", false), "UNCLEAR");
  });

  it("classifies empty page text as UNCLEAR", () => {
    assert.equal(classifyAcceptPage("", false), "UNCLEAR");
  });
});

describe("extractCampaignsUrlFromAcceptPageUrl", () => {
  const NORMALIZED_ID = "537-706-1556";

  it("extracts ocid from accept page URL — matches evidence URL pattern", () => {
    const pageUrl = "https://ads.google.com/aw/um/accept?ocid=8357912352&authuser=0";
    const url = extractCampaignsUrlFromAcceptPageUrl(pageUrl, NORMALIZED_ID);
    assert.equal(url, "https://ads.google.com/aw/campaigns?ocid=8357912352");
  });

  it("uses ocid over the normalized customer id when both are available", () => {
    const pageUrl = "https://ads.google.com/aw/um/accept?ocid=9999999999";
    const url = extractCampaignsUrlFromAcceptPageUrl(pageUrl, NORMALIZED_ID);
    assert.equal(url, "https://ads.google.com/aw/campaigns?ocid=9999999999");
  });

  it("falls back to buildGoogleAdsCampaignsUrl when URL has no ocid param", () => {
    const pageUrl = "https://ads.google.com/aw/um/accept?token=abc123";
    const url = extractCampaignsUrlFromAcceptPageUrl(pageUrl, NORMALIZED_ID);
    // Falls back to the builder which uses normalizedCustomerId digits
    assert.ok(url.includes("5377061556"));
  });

  it("falls back when ocid param is non-numeric", () => {
    const pageUrl = "https://ads.google.com/aw/um/accept?ocid=abc-not-digits";
    const url = extractCampaignsUrlFromAcceptPageUrl(pageUrl, NORMALIZED_ID);
    assert.ok(url.includes("5377061556"));
  });

  it("falls back gracefully on an unparseable URL", () => {
    const url = extractCampaignsUrlFromAcceptPageUrl("not a url", NORMALIZED_ID);
    assert.ok(url.includes("5377061556"));
  });
});
