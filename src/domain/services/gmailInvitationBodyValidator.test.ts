import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateInvitationBody } from "./gmailInvitationBodyValidator.js";

const VALID_SUBJECT = "Accept your invitation to access a Google Ads account";
const VALID_BODY =
  "Google Ads Account Name: IDR-01\nGoogle Ads Customer ID: 537-706-1556\nAccess Level: Standard";

describe("validateInvitationBody", () => {
  it("returns VALID for a well-formed invitation", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY);
    assert.equal(result.status, "VALID");
    assert.equal(result.customerId, "537-706-1556");
    assert.equal(result.accountName, "IDR-01");
    assert.equal(result.accessLevel, "Standard");
  });

  it("returns EXPIRED_OR_CANCELLED when body contains 'expired'", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY + "\nThis invitation has expired.");
    assert.equal(result.status, "EXPIRED_OR_CANCELLED");
  });

  it("returns EXPIRED_OR_CANCELLED when body contains 'cancelled'", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY + "\nThis invitation was cancelled.");
    assert.equal(result.status, "EXPIRED_OR_CANCELLED");
  });

  it("returns EXPIRED_OR_CANCELLED when body contains 'canceled' (US spelling)", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY + "\nInvitation canceled.");
    assert.equal(result.status, "EXPIRED_OR_CANCELLED");
  });

  it("returns EXPIRED_OR_CANCELLED when body contains 'no longer available'", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY + "\nThis access is no longer available.");
    assert.equal(result.status, "EXPIRED_OR_CANCELLED");
  });

  it("returns ALREADY_ACCEPTED when body contains 'already accepted'", () => {
    const result = validateInvitationBody(VALID_SUBJECT, VALID_BODY + "\nYou have already accepted this invitation.");
    assert.equal(result.status, "ALREADY_ACCEPTED");
  });

  it("returns INVALID_FORMAT when subject does not match", () => {
    const result = validateInvitationBody("Some other subject", VALID_BODY);
    assert.equal(result.status, "INVALID_FORMAT");
  });

  it("returns INVALID_FORMAT when body has no customer id", () => {
    const result = validateInvitationBody(VALID_SUBJECT, "Google Ads Account Name: IDR-01\nAccess Level: Standard");
    assert.equal(result.status, "INVALID_FORMAT");
    assert.equal(result.customerId, null);
  });

  it("extracts plain 10-digit customer id from body", () => {
    const body = "Google Ads Customer ID: 5377061556\nAccess Level: Standard";
    const result = validateInvitationBody(VALID_SUBJECT, body);
    assert.equal(result.status, "VALID");
    assert.equal(result.customerId, "537-706-1556");
  });

  it("prioritises EXPIRED_OR_CANCELLED over ALREADY_ACCEPTED when both signals present", () => {
    const body = VALID_BODY + "\nThis invitation has expired. You have already accepted this.";
    const result = validateInvitationBody(VALID_SUBJECT, body);
    assert.equal(result.status, "EXPIRED_OR_CANCELLED");
  });
});
