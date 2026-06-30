import { buildGoogleAdsCampaignsUrl } from "./googleAdsCampaignsUrlBuilder.js";

export type AcceptPageClassification =
  | "ALREADY_ACCEPTED"
  | "SUCCESS"
  | "EXPIRED_OR_CANCELLED"
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
  /expired|cancelled|canceled|no longer valid|no longer available/i;

/**
 * Pure, fully unit-testable.
 *
 * Classifies a Google Ads invitation accept-result page from its text content.
 * `hasConfirmButton` should be true when a Confirm/Accept/Continue button is
 * present on the page.
 *
 * ALREADY_ACCEPTED is checked before EXPIRED_OR_CANCELLED so that the
 * "already accepted + sign-in" page is never mis-classified as expired.
 */
export function classifyAcceptPage(pageText: string, hasConfirmButton: boolean): AcceptPageClassification {
  if (ALREADY_ACCEPTED_RE.test(pageText)) return "ALREADY_ACCEPTED";
  if (SUCCESS_RE.test(pageText)) return "SUCCESS";
  if (EXPIRED_OR_CANCELLED_RE.test(pageText)) return "EXPIRED_OR_CANCELLED";
  if (hasConfirmButton) return "NEEDS_CONFIRM";
  return "UNCLEAR";
}

/**
 * Pure, fully unit-testable.
 *
 * Builds the Google Ads campaigns URL for the ALREADY_ACCEPTED case.
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
      return `https://ads.google.com/aw/campaigns?ocid=${ocid}`;
    }
  } catch {
    // unparseable URL — fall through
  }
  return buildGoogleAdsCampaignsUrl(normalizedCustomerId);
}
