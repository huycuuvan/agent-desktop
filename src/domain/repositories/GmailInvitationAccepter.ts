import type { GmailInvitationCandidate } from "../entities/GmailInvitation.js";
import type { GmailSession } from "./GmailInvitationSearcher.js";

export type GmailAcceptOutcome =
  | { kind: "ACCEPTED"; acceptUrl: string | null }
  | { kind: "ALREADY_ACCEPTED"; campaignsUrl: string | null; screenshotPath: string | null }
  | { kind: "MANUAL_ACTION_REQUIRED"; screenshotPath: string | null }
  | { kind: "FAILED"; reason: string; screenshotPath: string | null };

export interface GmailInvitationAccepter {
  /** Clicks ACCEPT INVITATION on the given candidate. Must only be called after GmailInvitationValidator confirms an exact id match. */
  accept(session: GmailSession, candidate: GmailInvitationCandidate): Promise<GmailAcceptOutcome>;
}
