import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAcceptMccCommand } from "./telegramCommandParser.js";

describe("parseAcceptMccCommand", () => {
  it("parses /accept_mcc with dashed id", () => {
    const result = parseAcceptMccCommand({ text: "/accept_mcc 537-706-1556" });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("parses /accept_mcc with plain 10-digit id", () => {
    const result = parseAcceptMccCommand({ text: "/accept_mcc 5377061556" });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("parses @bot mention with plain id", () => {
    const result = parseAcceptMccCommand({ text: "@mybot 5377061556" });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("parses @bot mention with dashed id", () => {
    const result = parseAcceptMccCommand({ text: "@mybot 537-706-1556" });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("falls back to replied-to text when /accept_mcc has no id", () => {
    const result = parseAcceptMccCommand({
      text: "/accept_mcc",
      repliedToText: "Provider account: 537-706-1556 ready",
    });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("falls back to replied-to text when @mention has no id", () => {
    const result = parseAcceptMccCommand({
      text: "@mybot",
      repliedToText: "new MCC 5377061556",
    });
    assert.deepEqual(result, { customerId: "537-706-1556" });
  });

  it("returns error when no id found anywhere", () => {
    const result = parseAcceptMccCommand({ text: "/accept_mcc", repliedToText: "no id here" });
    assert.deepEqual(result, { error: "NO_CUSTOMER_ID_FOUND" });
  });

  it("returns error when message is not a command or mention", () => {
    const result = parseAcceptMccCommand({ text: "537-706-1556" });
    assert.deepEqual(result, { error: "NO_CUSTOMER_ID_FOUND" });
  });

  it("returns error for empty text", () => {
    const result = parseAcceptMccCommand({ text: "" });
    assert.deepEqual(result, { error: "NO_CUSTOMER_ID_FOUND" });
  });
});
