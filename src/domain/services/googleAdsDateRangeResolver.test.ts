import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGoogleAdsDateRangeLabel, resolveGoogleAdsDateMode } from "./googleAdsDateRangeResolver.js";

describe("resolveGoogleAdsDateMode", () => {
  it("resolves AUTO to LAST_2_DAYS with the 'Last 2 days' label", () => {
    assert.deepEqual(resolveGoogleAdsDateMode("AUTO"), {
      effectiveMode: "LAST_2_DAYS",
      googleAdsDateLabel: "Last 2 days",
    });
  });

  it("passes through TODAY, YESTERDAY, and LAST_2_DAYS with their own labels", () => {
    assert.deepEqual(resolveGoogleAdsDateMode("TODAY"), { effectiveMode: "TODAY", googleAdsDateLabel: "Today" });
    assert.deepEqual(resolveGoogleAdsDateMode("YESTERDAY"), { effectiveMode: "YESTERDAY", googleAdsDateLabel: "Yesterday" });
    assert.deepEqual(resolveGoogleAdsDateMode("LAST_2_DAYS"), { effectiveMode: "LAST_2_DAYS", googleAdsDateLabel: "Last 2 days" });
  });
});

describe("parseGoogleAdsDateRangeLabel", () => {
  it("parses a single-day label", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Jun 29, 2026"), {
      fromDate: "2026-06-29",
      toDate: "2026-06-29",
    });
  });

  it("parses a same-month range using an en dash, as rendered live by Google Ads", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Jun 28 – 29, 2026"), {
      fromDate: "2026-06-28",
      toDate: "2026-06-29",
    });
  });

  it("parses a same-month range using a plain hyphen", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Jun 28 - 29, 2026"), {
      fromDate: "2026-06-28",
      toDate: "2026-06-29",
    });
  });

  it("parses a range crossing a month boundary", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Jun 30 – Jul 1, 2026"), {
      fromDate: "2026-06-30",
      toDate: "2026-07-01",
    });
  });

  it("strips a trailing comparison-period suffix before parsing", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Jun 28 – 29, 2026"), {
      fromDate: "2026-06-28",
      toDate: "2026-06-29",
    });
  });

  it("returns nulls for null, empty, or unparseable text", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel(null), { fromDate: null, toDate: null });
    assert.deepEqual(parseGoogleAdsDateRangeLabel(""), { fromDate: null, toDate: null });
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Custom"), { fromDate: null, toDate: null });
  });

  it("returns nulls for an unrecognized month abbreviation", () => {
    assert.deepEqual(parseGoogleAdsDateRangeLabel("Xyz 29, 2026"), { fromDate: null, toDate: null });
  });
});
