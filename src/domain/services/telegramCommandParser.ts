import { normalizeCustomerId } from "./customerIdParser.js";

export interface AcceptMccCommandInput {
  text: string;
  repliedToText?: string | null;
}

export type AcceptMccCommandResult = { customerId: string } | { error: "NO_CUSTOMER_ID_FOUND" };

/**
 * Supported /accept_mcc command formats:
 *
 *   Format 1: /accept_mcc 834-666-6109
 *   Format 2: /accept_mcc@botname 834-666-6109   (Telegram group suffix)
 *   Format 3: @botname /accept_mcc 834-666-6109  (mention-then-command)
 *
 * The regex matches any of these as the opening of the message text.
 * After matching, normalizeCustomerId scans the full text for a 10-digit id.
 */
const ACCEPT_MCC_RE =
  /^\s*(?:\/accept_mcc(?:@\w+)?|@\w+\s+\/accept_mcc(?:@\w+)?|@\w+)\b/i;

const CHECK_COMMAND_RE = /^\s*\/(check(?:_now)?|run_collector)(?:@\w+)?\b/i;

const WHOAMI_RE = /^\s*\/whoami(?:@\w+)?\b/i;

/**
 * Returns true when the text begins with a recognised /accept_mcc command
 * (any of the three supported formats).
 */
export function isAcceptMccCommand(text: string): boolean {
  return ACCEPT_MCC_RE.test(text.trim());
}

/**
 * Returns true when the text is a /check / /check_now / /run_collector command
 * (with optional @botname group suffix).
 */
export function isCheckCommand(text: string): boolean {
  return CHECK_COMMAND_RE.test(text.trim());
}

/**
 * Returns true when the text is a /whoami command (with optional @botname suffix).
 */
export function isWhoamiCommand(text: string): boolean {
  return WHOAMI_RE.test(text.trim());
}

/**
 * Parses the customer ID from an /accept_mcc command in any supported format:
 *
 *   /accept_mcc 834-666-6109
 *   /accept_mcc@botname 834-666-6109
 *   @botname /accept_mcc 834-666-6109
 *   @botname 834-666-6109            (bare mention with id)
 *   /accept_mcc                      (reply — id taken from repliedToText)
 *   @botname /accept_mcc             (reply — id taken from repliedToText)
 *
 * Returns the normalized ("834-666-6109") customer id, or an error object.
 */
export function parseAcceptMccCommand(input: AcceptMccCommandInput): AcceptMccCommandResult {
  const trimmed = input.text.trim();

  if (!isAcceptMccCommand(trimmed)) {
    return { error: "NO_CUSTOMER_ID_FOUND" };
  }

  const fromCommandText = normalizeCustomerId(trimmed);
  if (fromCommandText) {
    return { customerId: fromCommandText };
  }

  if (input.repliedToText) {
    const fromReply = normalizeCustomerId(input.repliedToText);
    if (fromReply) {
      return { customerId: fromReply };
    }
  }

  return { error: "NO_CUSTOMER_ID_FOUND" };
}
