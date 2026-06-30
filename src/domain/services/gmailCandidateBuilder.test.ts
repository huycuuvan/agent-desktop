import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCandidateMatch, type CandidateMatchInput } from "./gmailCandidateBuilder.js";
import { normalizeCustomerId } from "./customerIdParser.js";

const CUSTOMER_ID = "537-706-1556";
const CUSTOMER_ID_PLAIN = "5377061556";
const SUBJECT = "Accept your invitation to access a Google Ads account";
const VALID_BODY =
  "Google Ads Account Name: IDR-01\nGoogle Ads Customer ID: 537-706-1556\nAccess Level: Standard";
const ROW_PREVIEW = `Google ${SUBJECT} ${CUSTOMER_ID} 2 days ago`;
const MSG_ID = "abc123";
const ACCEPT_URL = "https://accounts.google.com/AcceptInvitation?token=xyz";

function input(overrides: Partial<CandidateMatchInput> = {}): CandidateMatchInput {
  return {
    messageId: MSG_ID,
    subject: SUBJECT,
    bodyText: VALID_BODY,
    rowPreviewText: ROW_PREVIEW,
    normalizedCustomerId: CUSTOMER_ID,
    acceptUrl: ACCEPT_URL,
    ...overrides,
  };
}

describe("resolveCandidateMatch — primary path (body has customer id)", () => {
  it("returns a clean candidate when body and accept URL are both present", () => {
    const result = resolveCandidateMatch(input());
    assert.ok(result.candidate !== null);
    assert.equal(result.candidate!.candidateReason, null);
    assert.equal(result.candidate!.body, VALID_BODY);
    assert.equal(result.candidate!.subject, SUBJECT);
    assert.equal(result.candidate!.acceptUrl, ACCEPT_URL);
    assert.equal(result.bodyContainsCustomerId, true);
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.acceptUrlFound, true);
  });

  it("returns ACCEPT_URL_NOT_FOUND when body confirms id but accept URL is missing", () => {
    const result = resolveCandidateMatch(input({ acceptUrl: null }));
    assert.ok(result.candidate !== null);
    assert.equal(result.candidate!.candidateReason, "ACCEPT_URL_NOT_FOUND");
    assert.equal(result.acceptUrlFound, false);
    assert.equal(result.fallbackUsed, false);
  });

  it("matches body containing plain 10-digit customer id", () => {
    const body = `Google Ads Customer ID: ${CUSTOMER_ID_PLAIN}\nAccess Level: Standard`;
    const result = resolveCandidateMatch(input({ bodyText: body }));
    assert.ok(result.candidate !== null);
    assert.equal(result.bodyContainsCustomerId, true);
    assert.equal(result.fallbackUsed, false);
  });

  it("uses extracted subject from page even on primary path", () => {
    const result = resolveCandidateMatch(input({ subject: "  Accept your invitation  " }));
    assert.equal(result.candidate!.subject, "Accept your invitation");
  });
});

describe("resolveCandidateMatch — fallback path (body empty, row preview confirms)", () => {
  it("returns BODY_READ_FALLBACK_USED when body is null but row preview has id + subject", () => {
    const result = resolveCandidateMatch(input({ bodyText: null }));
    assert.ok(result.candidate !== null);
    assert.equal(result.candidate!.candidateReason, "BODY_READ_FALLBACK_USED");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.bodyContainsCustomerId, false);
    assert.equal(result.rowContainsCustomerId, true);
    assert.equal(result.acceptUrlFound, true);
  });

  it("returns BODY_READ_FALLBACK_USED when body is empty string", () => {
    const result = resolveCandidateMatch(input({ bodyText: "" }));
    assert.ok(result.candidate !== null);
    assert.equal(result.candidate!.candidateReason, "BODY_READ_FALLBACK_USED");
    assert.equal(result.fallbackUsed, true);
  });

  it("fallback body contains the customer id so the matcher can find it", () => {
    const result = resolveCandidateMatch(input({ bodyText: null }));
    // The synthesized body must contain the customer id so matchInvitationCandidates works.
    assert.equal(normalizeCustomerId(result.candidate!.body), CUSTOMER_ID);
  });

  it("returns ACCEPT_URL_NOT_FOUND (not BODY_READ_FALLBACK_USED) when both body and accept URL are missing", () => {
    const result = resolveCandidateMatch(input({ bodyText: null, acceptUrl: null }));
    assert.ok(result.candidate !== null);
    // ACCEPT_URL_NOT_FOUND takes priority so the caller knows the most important missing piece.
    assert.equal(result.candidate!.candidateReason, "ACCEPT_URL_NOT_FOUND");
    assert.equal(result.fallbackUsed, true);
  });

  it("uses row preview text that contains plain 10-digit id as fallback", () => {
    const rowPreview = `${SUBJECT} ${CUSTOMER_ID_PLAIN} yesterday`;
    const result = resolveCandidateMatch(input({ bodyText: null, rowPreviewText: rowPreview }));
    assert.ok(result.candidate !== null);
    assert.equal(result.rowContainsCustomerId, true);
    assert.equal(result.fallbackUsed, true);
  });

  it("falls back to row preview for subject when subject extraction failed", () => {
    const result = resolveCandidateMatch(input({ bodyText: null, subject: null }));
    assert.ok(result.candidate !== null);
    // Subject must contain something useful for validateInvitationBody.
    assert.ok(result.candidate!.subject.length > 0);
  });

  it("includes existing body text in synthetic body when it is non-empty but id-missing", () => {
    // Body was partially read (some content) but customer id was not extractable.
    const partialBody = "Access Level: Standard\nSome other text";
    const result = resolveCandidateMatch(input({ bodyText: partialBody }));
    // Body doesn't contain the id so bodyContainsCustomerId is false, but row does.
    assert.equal(result.bodyContainsCustomerId, false);
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.candidate !== null);
    // The synthesized body must still contain the customer id for the matcher.
    assert.equal(normalizeCustomerId(result.candidate!.body), CUSTOMER_ID);
  });
});

describe("resolveCandidateMatch — no match", () => {
  it("returns null candidate when body has wrong id and row preview has wrong id", () => {
    const result = resolveCandidateMatch(
      input({
        bodyText: "Google Ads Customer ID: 999-888-7777",
        rowPreviewText: `${SUBJECT} 999-888-7777 yesterday`,
      }),
    );
    assert.equal(result.candidate, null);
    assert.equal(result.bodyContainsCustomerId, false);
    assert.equal(result.rowContainsCustomerId, false);
  });

  it("returns null when body is null and row preview contains id but not the subject keyword", () => {
    const result = resolveCandidateMatch(
      input({
        bodyText: null,
        rowPreviewText: `Provider account ${CUSTOMER_ID} is ready`,
      }),
    );
    assert.equal(result.candidate, null);
    assert.equal(result.rowContainsCustomerId, true); // id present but subject missing
  });

  it("returns null when both body and row preview are empty", () => {
    const result = resolveCandidateMatch(input({ bodyText: "", rowPreviewText: "" }));
    assert.equal(result.candidate, null);
  });
});
