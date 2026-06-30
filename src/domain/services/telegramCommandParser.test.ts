import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAcceptMccCommand,
  isAcceptMccCommand,
  isCheckCommand,
  isWhoamiCommand,
} from "./telegramCommandParser.js";

describe("isAcceptMccCommand", () => {
  // Format 1 — plain command
  it("matches /accept_mcc", () => assert.equal(isAcceptMccCommand("/accept_mcc"), true));
  it("matches /accept_mcc with id", () =>
    assert.equal(isAcceptMccCommand("/accept_mcc 834-666-6109"), true));

  // Format 2 — group suffix
  it("matches /accept_mcc@botname", () =>
    assert.equal(isAcceptMccCommand("/accept_mcc@desktop_agent_qka_bot"), true));
  it("matches /accept_mcc@botname with id", () =>
    assert.equal(isAcceptMccCommand("/accept_mcc@desktop_agent_qka_bot 834-666-6109"), true));

  // Format 3 — mention-then-command
  it("matches @botname /accept_mcc with id", () =>
    assert.equal(isAcceptMccCommand("@desktop_agent_qka_bot /accept_mcc 834-666-6109"), true));
  it("matches @botname /accept_mcc without id (reply fallback)", () =>
    assert.equal(isAcceptMccCommand("@desktop_agent_qka_bot /accept_mcc"), true));

  // Bare mention with id (legacy @bot <id>)
  it("matches @bot 5377061556", () => assert.equal(isAcceptMccCommand("@mybot 5377061556"), true));

  // Non-commands
  it("does not match plain text", () => assert.equal(isAcceptMccCommand("hello"), false));
  it("does not match bare id with no prefix", () =>
    assert.equal(isAcceptMccCommand("834-666-6109"), false));
  it("does not match /check", () => assert.equal(isAcceptMccCommand("/check"), false));
});

describe("parseAcceptMccCommand", () => {
  // Format 1
  it("parses /accept_mcc with dashed id", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "/accept_mcc 537-706-1556" }), {
      customerId: "537-706-1556",
    });
  });

  it("parses /accept_mcc with plain 10-digit id", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "/accept_mcc 5377061556" }), {
      customerId: "537-706-1556",
    });
  });

  // Format 2
  it("parses /accept_mcc@botname with id", () => {
    assert.deepEqual(
      parseAcceptMccCommand({ text: "/accept_mcc@desktop_agent_qka_bot 834-666-6109" }),
      { customerId: "834-666-6109" },
    );
  });

  it("parses /accept_mcc@botname as reply fallback", () => {
    assert.deepEqual(
      parseAcceptMccCommand({
        text: "/accept_mcc@mybot",
        repliedToText: "provider MCC 5377061556",
      }),
      { customerId: "537-706-1556" },
    );
  });

  // Format 3 — @mention /accept_mcc <id>
  it("parses @botname /accept_mcc with id", () => {
    assert.deepEqual(
      parseAcceptMccCommand({ text: "@desktop_agent_qka_bot /accept_mcc 834-666-6109" }),
      { customerId: "834-666-6109" },
    );
  });

  it("parses @botname /accept_mcc@suffix with id", () => {
    assert.deepEqual(
      parseAcceptMccCommand({ text: "@desktop_agent_qka_bot /accept_mcc@otherbot 834-666-6109" }),
      { customerId: "834-666-6109" },
    );
  });

  it("parses @botname /accept_mcc as reply fallback", () => {
    assert.deepEqual(
      parseAcceptMccCommand({
        text: "@desktop_agent_qka_bot /accept_mcc",
        repliedToText: "new account 8346666109",
      }),
      { customerId: "834-666-6109" },
    );
  });

  // Bare @mention with id (legacy)
  it("parses @bot mention with plain id", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "@mybot 5377061556" }), {
      customerId: "537-706-1556",
    });
  });

  it("parses @bot mention with dashed id", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "@mybot 537-706-1556" }), {
      customerId: "537-706-1556",
    });
  });

  // Reply fallback
  it("falls back to replied-to text when /accept_mcc has no id", () => {
    assert.deepEqual(
      parseAcceptMccCommand({
        text: "/accept_mcc",
        repliedToText: "Provider account: 537-706-1556 ready",
      }),
      { customerId: "537-706-1556" },
    );
  });

  it("falls back to replied-to text when @mention has no id", () => {
    assert.deepEqual(
      parseAcceptMccCommand({ text: "@mybot", repliedToText: "new MCC 5377061556" }),
      { customerId: "537-706-1556" },
    );
  });

  // Error cases
  it("returns error when no id found anywhere", () => {
    assert.deepEqual(
      parseAcceptMccCommand({ text: "/accept_mcc", repliedToText: "no id here" }),
      { error: "NO_CUSTOMER_ID_FOUND" },
    );
  });

  it("returns error when message is not a command or mention", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "537-706-1556" }), {
      error: "NO_CUSTOMER_ID_FOUND",
    });
  });

  it("returns error for empty text", () => {
    assert.deepEqual(parseAcceptMccCommand({ text: "" }), { error: "NO_CUSTOMER_ID_FOUND" });
  });
});

describe("isCheckCommand", () => {
  it("matches /check", () => assert.equal(isCheckCommand("/check"), true));
  it("matches /check_now", () => assert.equal(isCheckCommand("/check_now"), true));
  it("matches /run_collector", () => assert.equal(isCheckCommand("/run_collector"), true));
  it("matches /check@botname group suffix", () => assert.equal(isCheckCommand("/check@mybot"), true));
  it("matches /run_collector@botname group suffix", () =>
    assert.equal(isCheckCommand("/run_collector@mybot"), true));
  it("does not match /accept_mcc", () => assert.equal(isCheckCommand("/accept_mcc 123"), false));
  it("does not match random text", () => assert.equal(isCheckCommand("hello"), false));
});

describe("isWhoamiCommand", () => {
  it("matches /whoami", () => assert.equal(isWhoamiCommand("/whoami"), true));
  it("matches /whoami@botname", () => assert.equal(isWhoamiCommand("/whoami@mybot"), true));
  it("does not match /accept_mcc", () => assert.equal(isWhoamiCommand("/accept_mcc"), false));
  it("does not match random text", () => assert.equal(isWhoamiCommand("hello"), false));
});
