import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectVisibleMatchingRows, type GmailRowInfo } from "./gmailRowSelector.js";

const CUSTOMER_ID = "537-706-1556";
const CUSTOMER_ID_PLAIN = "5377061556";
const SUBJECT_SNIPPET = "invitation to access a google ads account";

function row(index: number, visible: boolean, text: string): GmailRowInfo {
  return { index, visible, text };
}

function invitationRowText(customerId = CUSTOMER_ID): string {
  return `Google Accept your invitation to access a Google Ads account Google Ads ${customerId} 2 days ago`;
}

describe("selectVisibleMatchingRows — no match cases", () => {
  it("returns NO_MATCH for empty row list", () => {
    const result = selectVisibleMatchingRows([], CUSTOMER_ID);
    assert.equal(result.kind, "NO_MATCH");
    assert.equal(result.matchedCount, 0);
    assert.equal(result.visibleCount, 0);
  });

  it("returns NO_MATCH when all rows are hidden (not visible)", () => {
    const rows = [
      row(0, false, invitationRowText()),
      row(1, false, invitationRowText()),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "NO_MATCH");
    assert.equal(result.visibleCount, 0);
    assert.equal(result.matchedCount, 0);
  });

  it("returns NO_MATCH when visible rows exist but none contain the customer id", () => {
    const rows = [
      row(0, true, invitationRowText("999-888-7777")),
      row(1, true, "Some unrelated email row"),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "NO_MATCH");
    assert.equal(result.visibleCount, 2);
    assert.equal(result.matchedCount, 0);
  });

  it("returns NO_MATCH when visible row contains customer id but not the invitation subject", () => {
    const rows = [row(0, true, `Provider sent ${CUSTOMER_ID} please process`)];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "NO_MATCH");
    assert.equal(result.matchedCount, 0);
  });

  it("does not count hidden matching rows — no nth-index selection of non-visible rows", () => {
    // This is the exact bug: gmail puts matching rows at index 7+ in the DOM
    // but only index 1 is visible. Should only match the visible one.
    const rows = [
      row(0, false, invitationRowText()),  // hidden — must be ignored
      row(1, true, "Unrelated visible row"),
      row(2, false, invitationRowText()),  // hidden — must be ignored
      row(7, false, invitationRowText()),  // the problematic nth(7) row — hidden, must be ignored
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "NO_MATCH");
    assert.equal(result.visibleCount, 1);
    assert.equal(result.matchedCount, 0);
  });
});

describe("selectVisibleMatchingRows — single match", () => {
  it("returns SINGLE_MATCH for exactly one visible matching row", () => {
    const rows = [
      row(0, false, invitationRowText()),   // hidden — excluded
      row(1, true, invitationRowText()),    // visible and matching
      row(2, true, "Unrelated visible row"),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "SINGLE_MATCH");
    assert.equal(result.matchedCount, 1);
    assert.deepEqual(result.matchedIndices, [1]);
    assert.equal(result.visibleCount, 2);
    assert.ok(result.firstMatchPreview?.includes(SUBJECT_SNIPPET) || result.firstMatchPreview?.includes("invitation"));
  });

  it("matches row containing the plain 10-digit form of the customer id", () => {
    const rows = [
      row(0, true, `Accept your invitation to access a Google Ads account ${CUSTOMER_ID_PLAIN}`),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "SINGLE_MATCH");
    assert.deepEqual(result.matchedIndices, [0]);
  });

  it("returns the correct original index even when earlier rows are hidden", () => {
    const rows = [
      row(0, false, invitationRowText()),
      row(1, false, invitationRowText()),
      row(2, false, invitationRowText()),
      row(3, true, invitationRowText()),   // index 3 is the only visible match
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "SINGLE_MATCH");
    assert.deepEqual(result.matchedIndices, [3]);
  });

  it("is case-insensitive for the subject keyword", () => {
    const rows = [
      row(0, true, `ACCEPT YOUR INVITATION TO ACCESS A GOOGLE ADS ACCOUNT ${CUSTOMER_ID}`),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "SINGLE_MATCH");
  });
});

describe("selectVisibleMatchingRows — multiple matches safety", () => {
  it("returns MULTIPLE_MATCHES when two visible rows both match", () => {
    const rows = [
      row(0, true, invitationRowText()),
      row(1, true, invitationRowText()),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "MULTIPLE_MATCHES");
    assert.equal(result.matchedCount, 2);
    assert.deepEqual(result.matchedIndices, [0, 1]);
  });

  it("counts only visible multiple matches — hidden rows do not contribute", () => {
    const rows = [
      row(0, false, invitationRowText()),  // hidden — not counted
      row(1, true, invitationRowText()),   // visible match 1
      row(2, true, invitationRowText()),   // visible match 2
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.kind, "MULTIPLE_MATCHES");
    assert.equal(result.matchedCount, 2);
    assert.deepEqual(result.matchedIndices, [1, 2]);
  });
});

describe("selectVisibleMatchingRows — metadata", () => {
  it("reports visibleCount accurately", () => {
    const rows = [
      row(0, true, "visible 1"),
      row(1, false, "hidden"),
      row(2, true, "visible 2"),
      row(3, true, "visible 3"),
    ];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.equal(result.visibleCount, 3);
  });

  it("provides firstMatchPreview for the first matched row", () => {
    const text = invitationRowText();
    const rows = [row(0, true, text)];
    const result = selectVisibleMatchingRows(rows, CUSTOMER_ID);
    assert.ok(result.firstMatchPreview !== null);
    assert.ok(result.firstMatchPreview!.length <= 120);
  });

  it("sets firstMatchPreview to null when there is no match", () => {
    const result = selectVisibleMatchingRows([], CUSTOMER_ID);
    assert.equal(result.firstMatchPreview, null);
  });
});
