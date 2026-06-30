import { normalizeCustomerId } from "./customerIdParser.js";
import type { GmailInvitationCandidate } from "../entities/GmailInvitation.js";

const INVITATION_SUBJECT_KEYWORD = "invitation to access a google ads account";

export interface CandidateMatchInput {
  messageId: string;
  /** Subject line as read from the open email page. Null if the element was not found. */
  subject: string | null;
  /** Full body text as read from the open email page. Null/empty if extraction failed. */
  bodyText: string | null;
  /** Row preview text that was used to select this row before opening the email. */
  rowPreviewText: string;
  /** Normalized customer id that was requested (e.g. "537-706-1556"). */
  normalizedCustomerId: string;
  /** href of the ACCEPT INVITATION link, or null if not found. */
  acceptUrl: string | null;
}

export interface CandidateMatchResult {
  /** Null means neither body nor row preview confirm the customer id — treat as no match. */
  candidate: GmailInvitationCandidate | null;
  bodyContainsCustomerId: boolean;
  rowContainsCustomerId: boolean;
  fallbackUsed: boolean;
  acceptUrlFound: boolean;
}

/**
 * Pure function — no I/O, fully unit-testable.
 *
 * Resolves a single Gmail invitation candidate from the raw data read by the
 * browser executor. Handles two degraded cases without downgrading to NO_MATCH:
 *
 *  1. Body extraction succeeded, customer ID confirmed → clean candidate.
 *     If accept URL is missing → candidateReason "ACCEPT_URL_NOT_FOUND".
 *
 *  2. Body extraction failed (null/empty) BUT the row-preview text already
 *     confirms both the invitation subject and the customer ID → fallback
 *     candidate built from the row preview.
 *     candidateReason set to "BODY_READ_FALLBACK_USED" (or "ACCEPT_URL_NOT_FOUND"
 *     when that is also missing — the missing accept URL is the higher-priority note).
 *
 * Customer ID matching normalizes both the dashed ("537-706-1556") and plain
 * ("5377061556") forms, so whichever format appears in the body or row text is
 * correctly matched.
 *
 * Returns candidate=null only when neither source confirms the customer ID.
 */
export function resolveCandidateMatch(input: CandidateMatchInput): CandidateMatchResult {
  const digitsOnly = input.normalizedCustomerId.replace(/-/g, "");

  // Normalize what we read from the body (handles both dashed and plain forms).
  const bodyNormalized = input.bodyText ? normalizeCustomerId(input.bodyText) : null;
  const bodyContainsCustomerId = bodyNormalized === input.normalizedCustomerId;

  // Same for the row preview.
  const rowNormalized = normalizeCustomerId(input.rowPreviewText);
  const rowContainsCustomerId = rowNormalized === input.normalizedCustomerId;

  const rowContainsSubject = input.rowPreviewText.toLowerCase().includes(INVITATION_SUBJECT_KEYWORD);

  const acceptUrlFound = !!input.acceptUrl;

  // ── Primary path: body was successfully read and confirms the customer ID ──
  if (bodyContainsCustomerId) {
    return {
      candidate: {
        messageId: input.messageId,
        subject: (input.subject ?? "").trim(),
        body: input.bodyText!,
        acceptUrl: input.acceptUrl,
        candidateReason: acceptUrlFound ? null : "ACCEPT_URL_NOT_FOUND",
      },
      bodyContainsCustomerId,
      rowContainsCustomerId,
      fallbackUsed: false,
      acceptUrlFound,
    };
  }

  // ── Fallback path: body failed/empty, but row preview confirms subject + ID ──
  if (rowContainsCustomerId && rowContainsSubject) {
    // Build a body the matcher can use: prefer any real body text that at least
    // exists (it may contain the ID in a format normalizeCustomerId missed), then
    // append a canonical "Google Ads Customer ID: ..." line to guarantee the
    // matcher succeeds.
    const bodyBase =
      input.bodyText && input.bodyText.trim().length > 0
        ? input.bodyText.trim()
        : input.rowPreviewText;

    const bodyHasId =
      bodyBase.includes(input.normalizedCustomerId) || bodyBase.includes(digitsOnly);

    const syntheticBody = bodyHasId
      ? bodyBase
      : `${bodyBase}\nGoogle Ads Customer ID: ${input.normalizedCustomerId}`;

    // Subject: use what the page gave us; fall back to the row preview text
    // (validateInvitationBody uses a regex flexible enough to match within it).
    const subject = input.subject?.trim() || input.rowPreviewText;

    const candidateReason = acceptUrlFound ? "BODY_READ_FALLBACK_USED" : "ACCEPT_URL_NOT_FOUND";

    return {
      candidate: {
        messageId: input.messageId,
        subject,
        body: syntheticBody,
        acceptUrl: input.acceptUrl,
        candidateReason,
      },
      bodyContainsCustomerId,
      rowContainsCustomerId,
      fallbackUsed: true,
      acceptUrlFound,
    };
  }

  // ── No match from any source ──
  return {
    candidate: null,
    bodyContainsCustomerId,
    rowContainsCustomerId,
    fallbackUsed: false,
    acceptUrlFound,
  };
}
