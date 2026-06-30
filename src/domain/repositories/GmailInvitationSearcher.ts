import type { AdsPowerProfile } from "../entities/AdsPowerProfile.js";
import type { GmailInvitationCandidate } from "../entities/GmailInvitation.js";

/**
 * Opaque handle to the live Gmail browser session a search was performed in,
 * passed back into GmailInvitationAccepter/GoogleAdsOpener within the same
 * process run so they can act on the exact same already-open tab. Domain
 * code never inspects it — only infrastructure adapters know its real shape.
 */
export type GmailSession = unknown;

export type GmailSearchOutcome =
  | { kind: "TAB_NOT_FOUND" }
  | { kind: "SIGN_IN_REQUIRED" }
  /** No visible result row matched both the invitation subject and the requested customer id. */
  | { kind: "ROW_NO_MATCH" }
  /** More than one visible result row matched — refusing to open any to avoid a wrong accept. */
  | { kind: "ROW_MULTIPLE_MATCHES"; count: number }
  | { kind: "FOUND"; candidates: GmailInvitationCandidate[]; profile: AdsPowerProfile; session: GmailSession };

export interface GmailInvitationSearcher {
  search(normalizedCustomerId: string): Promise<GmailSearchOutcome>;
}
