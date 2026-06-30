import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchInvitationCandidates } from "./gmailInvitationMatcher.js";
import type { GmailInvitationCandidate } from "../entities/GmailInvitation.js";

const SUBJECT = "Accept your invitation to access a Google Ads account";

function makeCandidate(customerId: string, extra = ""): GmailInvitationCandidate {
  return {
    messageId: `msg_${customerId}`,
    subject: SUBJECT,
    body: `Google Ads Account Name: IDR-01\nGoogle Ads Customer ID: ${customerId}\nAccess Level: Standard\n${extra}`,
    acceptUrl: null,
    candidateReason: null,
  };
}

describe("matchInvitationCandidates — no match safety", () => {
  it("returns NO_MATCH when candidates list is empty", () => {
    const result = matchInvitationCandidates([], "537-706-1556");
    assert.equal(result.kind, "NO_MATCH");
  });

  it("returns NO_MATCH when no candidate body contains the requested id", () => {
    const candidates = [makeCandidate("123-456-7890"), makeCandidate("999-888-7777")];
    const result = matchInvitationCandidates(candidates, "537-706-1556");
    assert.equal(result.kind, "NO_MATCH");
  });

  it("does not match a partial id overlap", () => {
    const candidates = [makeCandidate("537-706-1557")];
    const result = matchInvitationCandidates(candidates, "537-706-1556");
    assert.equal(result.kind, "NO_MATCH");
  });
});

describe("matchInvitationCandidates — multiple match safety", () => {
  it("returns MULTIPLE_MATCHES when two candidates match the same id", () => {
    const candidates = [makeCandidate("537-706-1556"), makeCandidate("537-706-1556")];
    const result = matchInvitationCandidates(candidates, "537-706-1556");
    assert.equal(result.kind, "MULTIPLE_MATCHES");
    if (result.kind === "MULTIPLE_MATCHES") {
      assert.equal(result.candidates.length, 2);
    }
  });
});

describe("matchInvitationCandidates — successful match", () => {
  it("returns MATCH_FOUND for exactly one matching candidate", () => {
    const candidates = [makeCandidate("999-888-7777"), makeCandidate("537-706-1556")];
    const result = matchInvitationCandidates(candidates, "537-706-1556");
    assert.equal(result.kind, "MATCH_FOUND");
    if (result.kind === "MATCH_FOUND") {
      assert.equal(result.candidate.messageId, "msg_537-706-1556");
    }
  });

  it("matches by dashed id when body contains plain 10-digit id", () => {
    const candidate: GmailInvitationCandidate = {
      messageId: "msg_plain",
      subject: SUBJECT,
      body: "Google Ads Customer ID: 5377061556",
      acceptUrl: null,
      candidateReason: null,
    };
    const result = matchInvitationCandidates([candidate], "537-706-1556");
    assert.equal(result.kind, "MATCH_FOUND");
  });
});
