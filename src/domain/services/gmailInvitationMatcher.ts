import type { GmailInvitationCandidate } from "../entities/GmailInvitation.js";
import { normalizeCustomerId } from "./customerIdParser.js";

export type GmailInvitationMatchResult =
  | { kind: "MATCH_FOUND"; candidate: GmailInvitationCandidate }
  | { kind: "MULTIPLE_MATCHES"; candidates: GmailInvitationCandidate[] }
  | { kind: "NO_MATCH" };

/**
 * Safety-critical matcher: an invitation candidate only counts as a match if
 * the customer id parsed from its own body is *exactly* equal to the
 * requested normalized customer id. Never matches on subject text alone.
 * Multiple matches and zero matches both return non-accept-eligible results
 * so the caller never has to guess which candidate to accept.
 */
export function matchInvitationCandidates(
  candidates: GmailInvitationCandidate[],
  normalizedCustomerId: string,
): GmailInvitationMatchResult {
  const matches = candidates.filter((candidate) => normalizeCustomerId(candidate.body) === normalizedCustomerId);

  if (matches.length === 0) {
    return { kind: "NO_MATCH" };
  }

  if (matches.length > 1) {
    return { kind: "MULTIPLE_MATCHES", candidates: matches };
  }

  return { kind: "MATCH_FOUND", candidate: matches[0] };
}
