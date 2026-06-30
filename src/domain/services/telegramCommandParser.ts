import { normalizeCustomerId } from "./customerIdParser.js";

export interface AcceptMccCommandInput {
  text: string;
  repliedToText?: string | null;
}

export type AcceptMccCommandResult = { customerId: string } | { error: "NO_CUSTOMER_ID_FOUND" };

const ACCEPT_MCC_OR_MENTION_RE = /^\s*(\/accept_mcc\b|@\w+\b)/i;

/**
 * Parses the three supported ways of requesting an invitation accept:
 *  - "@bot 5377061556" / "@bot 537-706-1556"
 *  - "/accept_mcc 537-706-1556"
 *  - "/accept_mcc" sent as a reply to the provider's message — the customer id
 *    is then read from the replied-to message text instead.
 * Returns the normalized ("537-706-1556") customer id, or an error if none
 * could be found in either the command text or the replied-to text.
 */
export function parseAcceptMccCommand(input: AcceptMccCommandInput): AcceptMccCommandResult {
  const trimmed = input.text.trim();

  if (!ACCEPT_MCC_OR_MENTION_RE.test(trimmed)) {
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
