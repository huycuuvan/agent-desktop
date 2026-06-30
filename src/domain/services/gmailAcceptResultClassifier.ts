import { buildGoogleAdsCampaignsUrl } from "./googleAdsCampaignsUrlBuilder.js";

export type AcceptPageClassification =
  | "ALREADY_ACCEPTED"
  | "SUCCESS"
  | "EXPIRED_OR_CANCELLED"
  | "SIGN_IN_REQUIRED"
  | "NEEDS_CONFIRM"
  | "UNCLEAR";

// Order matters: ALREADY_ACCEPTED is checked first because some already-accepted
// pages also contain a "Sign in" button and phrases that could match the generic
// EXPIRED / not-available patterns.
const ALREADY_ACCEPTED_RE =
  /invitation has already been accepted|already been accepted|this account has already been added/i;

const SUCCESS_RE =
  /you now have access|invitation accepted|account access confirmed|you'?ve been added/i;

const EXPIRED_OR_CANCELLED_RE =
  /invitation has expired|invitation is no longer available|invitation has been cancelled|invitation was revoked|expired|cancelled|canceled|no longer valid|no longer available|revoked/i;

const SIGN_IN_RE = /sign in to google|sign in with google|sign.?in to continue|please sign in/i;

/**
 * Pure, fully unit-testable.
 *
 * Classifies a Google Ads invitation accept-result page from its text content.
 * `hasConfirmButton` should be true when a Confirm/Accept/Continue button or link
 * is present on the page. `hasSignInIndicator` should be true when a sign-in
 * form, input, or button is detected.
 *
 * Priority order:
 *   ALREADY_ACCEPTED > SUCCESS > EXPIRED_OR_CANCELLED > SIGN_IN_REQUIRED > NEEDS_CONFIRM > UNCLEAR
 */
export function classifyAcceptPage(
  pageText: string,
  hasConfirmButton: boolean,
  hasSignInIndicator = false,
): AcceptPageClassification {
  if (ALREADY_ACCEPTED_RE.test(pageText)) return "ALREADY_ACCEPTED";
  if (SUCCESS_RE.test(pageText)) return "SUCCESS";
  if (EXPIRED_OR_CANCELLED_RE.test(pageText)) return "EXPIRED_OR_CANCELLED";
  // A continue/accept button takes precedence over any sign-in text — the
  // welcome page ("click Continue to sign in to Google Ads") contains sign-in
  // phrasing but must be handled by clicking the button, not by bailing out.
  if (hasConfirmButton) return "NEEDS_CONFIRM";
  if (hasSignInIndicator || SIGN_IN_RE.test(pageText)) return "SIGN_IN_REQUIRED";
  return "UNCLEAR";
}

/**
 * Pure, fully unit-testable.
 *
 * Builds the Google Ads campaigns URL for the ALREADY_ACCEPTED / ACCEPTED case.
 * Prefers the `ocid` query param present in the accept-result page URL
 * (e.g. "https://ads.google.com/aw/um/accept?ocid=8357912352&..."),
 * which is the most direct link to the exact account.
 * Falls back to `buildGoogleAdsCampaignsUrl(normalizedCustomerId)` when
 * the URL cannot be parsed or lacks a numeric `ocid`.
 */
export function extractCampaignsUrlFromAcceptPageUrl(
  pageUrl: string,
  normalizedCustomerId: string,
): string {
  try {
    const ocid = new URL(pageUrl).searchParams.get("ocid");
    if (ocid && /^\d+$/.test(ocid)) {
      return `https://ads.google.com/aw/campaigns?ocid=${ocid}&workspaceId=0`;
    }
  } catch {
    // unparseable URL — fall through
  }
  return buildGoogleAdsCampaignsUrl(normalizedCustomerId);
}
