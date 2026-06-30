export type GmailIntakeStatus =
  | "SEARCHING"
  | "MATCH_FOUND"
  | "ACCEPTED"
  | "ALREADY_ACCEPTED"
  | "EXPIRED_OR_CANCELLED"
  | "GMAIL_TAB_NOT_FOUND"
  | "GMAIL_SIGN_IN_REQUIRED"
  | "MULTIPLE_MATCHES"
  | "NO_MATCH"
  | "MANUAL_ACTION_REQUIRED"
  | "FAILED";

export interface GmailInvitationCandidate {
  messageId: string;
  subject: string;
  body: string;
  acceptUrl: string | null;
  /**
   * Set when the candidate was built under degraded conditions:
   *  - "BODY_READ_FALLBACK_USED"  — body text was unreadable; row-preview used instead
   *  - "ACCEPT_URL_NOT_FOUND"     — body was valid but the ACCEPT INVITATION link is missing
   * Null on a clean extraction.
   */
  candidateReason: string | null;
}

export interface GmailIntakeLogInput {
  source: string;
  requestedCustomerId: string;
  normalizedCustomerId: string | null;
  gmailMessageSubject?: string | null;
  gmailMatchedCustomerId?: string | null;
  status: GmailIntakeStatus;
  reason?: string | null;
  acceptUrl?: string | null;
  adspowerProfileId?: string | null;
  screenshotPath?: string | null;
}

export interface GmailIntakeResult {
  status: GmailIntakeStatus;
  reason?: string | null;
  normalizedCustomerId: string | null;
  gmailMessageSubject?: string | null;
  acceptUrl?: string | null;
  campaignsUrl?: string | null;
  campaignsPageReady?: boolean | null;
  screenshotPath?: string | null;
}
