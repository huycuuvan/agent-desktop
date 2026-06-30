import type { GmailSession } from "./GmailInvitationSearcher.js";

export interface GoogleAdsOpenResult {
  opened: boolean;
  url: string;
}

export interface GoogleAdsOpener {
  openCampaigns(session: GmailSession, normalizedCustomerId: string): Promise<GoogleAdsOpenResult>;
}
