import { normalizeCustomerId } from "./customerIdParser.js";

export type InvitationBodyStatus = "VALID" | "EXPIRED_OR_CANCELLED" | "ALREADY_ACCEPTED" | "INVALID_FORMAT";

export interface InvitationBodyValidation {
  status: InvitationBodyStatus;
  customerId: string | null;
  accountName: string | null;
  accessLevel: string | null;
}

const EXPECTED_SUBJECT_RE = /accept your invitation to access a google ads account/i;
const EXPIRED_OR_CANCELLED_RE = /\b(expired|cancelled|canceled|no longer (available|valid))\b/i;
const ALREADY_ACCEPTED_RE = /already accepted/i;

/**
 * Validates a candidate Gmail invitation email's subject/body against the
 * known Google Ads invitation format before any accept action is attempted.
 * Safety-critical: callers must never click ACCEPT INVITATION unless this
 * returns status "VALID" and its customerId matches the requested one.
 */
export function validateInvitationBody(subject: string, body: string): InvitationBodyValidation {
  const customerId = normalizeCustomerId(body);
  const accountNameMatch = body.match(/Google Ads Account Name:\s*(.+)/i);
  const accessLevelMatch = body.match(/Access Level:\s*(.+)/i);
  const accountName = accountNameMatch ? accountNameMatch[1].trim() : null;
  const accessLevel = accessLevelMatch ? accessLevelMatch[1].trim() : null;

  if (EXPIRED_OR_CANCELLED_RE.test(body)) {
    return { status: "EXPIRED_OR_CANCELLED", customerId, accountName, accessLevel };
  }

  if (ALREADY_ACCEPTED_RE.test(body)) {
    return { status: "ALREADY_ACCEPTED", customerId, accountName, accessLevel };
  }

  if (!EXPECTED_SUBJECT_RE.test(subject) || !customerId) {
    return { status: "INVALID_FORMAT", customerId, accountName, accessLevel };
  }

  return { status: "VALID", customerId, accountName, accessLevel };
}
