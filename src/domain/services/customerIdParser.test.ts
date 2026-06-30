import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCustomerId, customerIdToDigits } from "./customerIdParser.js";

describe("normalizeCustomerId", () => {
  it("normalizes a plain 10-digit id", () => {
    assert.equal(normalizeCustomerId("5377061556"), "537-706-1556");
  });

  it("normalizes a dashed id", () => {
    assert.equal(normalizeCustomerId("537-706-1556"), "537-706-1556");
  });

  it("extracts id embedded in @bot mention text", () => {
    assert.equal(normalizeCustomerId("@bot 5377061556"), "537-706-1556");
  });

  it("extracts id embedded in /accept_mcc command text", () => {
    assert.equal(normalizeCustomerId("/accept_mcc 537-706-1556"), "537-706-1556");
  });

  it("extracts id from Gmail invitation body text", () => {
    const body = "Google Ads Account Name: IDR-01\nGoogle Ads Customer ID: 537-706-1556\nAccess Level: Standard";
    assert.equal(normalizeCustomerId(body), "537-706-1556");
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeCustomerId(""), null);
  });

  it("returns null for text with no valid 10-digit id", () => {
    assert.equal(normalizeCustomerId("hello world 12345"), null);
  });

  it("returns null for 9-digit number", () => {
    assert.equal(normalizeCustomerId("123456789"), null);
  });

  it("returns null for 11-digit number", () => {
    assert.equal(normalizeCustomerId("12345678901"), null);
  });

  it("does not match non-customer-id dashes like IDR-01", () => {
    const body = "Google Ads Account Name: IDR-01";
    assert.equal(normalizeCustomerId(body), null);
  });
});

describe("customerIdToDigits", () => {
  it("strips dashes from normalized id", () => {
    assert.equal(customerIdToDigits("537-706-1556"), "5377061556");
  });
});
