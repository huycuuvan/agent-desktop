import type { GmailIntakeResult, GmailIntakeStatus } from "../entities/GmailInvitation.js";
import type { GmailInvitationSearcher } from "../repositories/GmailInvitationSearcher.js";
import type { GmailInvitationAccepter } from "../repositories/GmailInvitationAccepter.js";
import type { GoogleAdsOpener } from "../repositories/GoogleAdsOpener.js";
import type { GmailIntakeLogRepository } from "../repositories/GmailIntakeLogRepository.js";
import { normalizeCustomerId } from "../services/customerIdParser.js";
import { matchInvitationCandidates } from "../services/gmailInvitationMatcher.js";
import { validateInvitationBody } from "../services/gmailInvitationBodyValidator.js";

interface LogFields {
  source: string;
  requestedCustomerId: string;
  normalizedCustomerId: string | null;
  gmailMessageSubject?: string | null;
  gmailMatchedCustomerId?: string | null;
  acceptUrl?: string | null;
  adspowerProfileId?: string | null;
  screenshotPath?: string | null;
}

export class GmailIntakeUseCase {
  constructor(
    private readonly searcher: GmailInvitationSearcher,
    private readonly accepter: GmailInvitationAccepter,
    private readonly adsOpener: GoogleAdsOpener,
    private readonly logRepository: GmailIntakeLogRepository,
    private readonly enabled: boolean,
  ) {}

  /** Read-only: finds and validates a matching invitation, but never clicks accept. */
  async search(requestedCustomerId: string, source: string): Promise<GmailIntakeResult> {
    return this.run(requestedCustomerId, source, false);
  }

  /** Full flow: search -> validate -> accept -> open Google Ads campaigns page. */
  async acceptInvitation(requestedCustomerId: string, source: string): Promise<GmailIntakeResult> {
    return this.run(requestedCustomerId, source, true);
  }

  private async run(requestedCustomerId: string, source: string, doAccept: boolean): Promise<GmailIntakeResult> {
    const normalized = normalizeCustomerId(requestedCustomerId);
    const base: LogFields = { source, requestedCustomerId, normalizedCustomerId: normalized };

    if (!normalized) {
      return this.finish(base, "FAILED", "INVALID_CUSTOMER_ID");
    }

    if (!this.enabled) {
      return this.finish(base, "FAILED", "GMAIL_WEB_INTAKE_DISABLED");
    }

    await this.log(base, "SEARCHING");

    const searchOutcome = await this.searcher.search(normalized);

    if (searchOutcome.kind === "TAB_NOT_FOUND") {
      return this.finish(base, "GMAIL_TAB_NOT_FOUND");
    }
    if (searchOutcome.kind === "SIGN_IN_REQUIRED") {
      return this.finish(base, "GMAIL_SIGN_IN_REQUIRED");
    }
    if (searchOutcome.kind === "ROW_NO_MATCH") {
      return this.finish(base, "NO_MATCH");
    }
    if (searchOutcome.kind === "ROW_MULTIPLE_MATCHES") {
      return this.finish(base, "MULTIPLE_MATCHES", `${searchOutcome.count} visible matching rows found`);
    }

    const withProfile: LogFields = { ...base, adspowerProfileId: searchOutcome.profile.profileId };
    const matchResult = matchInvitationCandidates(searchOutcome.candidates, normalized);

    if (matchResult.kind === "NO_MATCH") {
      return this.finish(withProfile, "NO_MATCH");
    }
    if (matchResult.kind === "MULTIPLE_MATCHES") {
      return this.finish(withProfile, "MULTIPLE_MATCHES", `${matchResult.candidates.length} matching invitations found`);
    }

    const { candidate } = matchResult;
    const validation = validateInvitationBody(candidate.subject, candidate.body);
    const withCandidate: LogFields = {
      ...withProfile,
      gmailMessageSubject: candidate.subject,
      gmailMatchedCustomerId: validation.customerId,
      acceptUrl: candidate.acceptUrl,
    };

    if (validation.status === "EXPIRED_OR_CANCELLED") {
      return this.finish(withCandidate, "EXPIRED_OR_CANCELLED");
    }
    if (validation.status === "ALREADY_ACCEPTED") {
      return this.finish(withCandidate, "ALREADY_ACCEPTED");
    }
    if (validation.status === "INVALID_FORMAT" || validation.customerId !== normalized) {
      return this.finish(withCandidate, "NO_MATCH", "EMAIL_CUSTOMER_ID_MISMATCH");
    }

    if (!doAccept) {
      return this.finish(withCandidate, "MATCH_FOUND", candidate.candidateReason ?? undefined);
    }

    await this.log(withCandidate, "MATCH_FOUND");

    const acceptOutcome = await this.accepter.accept(searchOutcome.session, candidate);

    if (acceptOutcome.kind === "ALREADY_ACCEPTED") {
      return this.finish(
        { ...withCandidate, screenshotPath: acceptOutcome.screenshotPath },
        "ALREADY_ACCEPTED",
        undefined,
        acceptOutcome.campaignsUrl ?? undefined,
      );
    }
    if (acceptOutcome.kind === "MANUAL_ACTION_REQUIRED") {
      return this.finish({ ...withCandidate, screenshotPath: acceptOutcome.screenshotPath }, "MANUAL_ACTION_REQUIRED");
    }
    if (acceptOutcome.kind === "FAILED") {
      return this.finish({ ...withCandidate, screenshotPath: acceptOutcome.screenshotPath }, "FAILED", acceptOutcome.reason);
    }

    const adsResult = await this.adsOpener.openCampaigns(searchOutcome.session, normalized);

    return this.finish(
      { ...withCandidate, acceptUrl: acceptOutcome.acceptUrl ?? withCandidate.acceptUrl },
      "ACCEPTED",
      undefined,
      adsResult.url,
    );
  }

  private async finish(
    fields: LogFields,
    status: GmailIntakeStatus,
    reason?: string,
    campaignsUrl?: string,
  ): Promise<GmailIntakeResult> {
    await this.log(fields, status, reason);
    return {
      status,
      reason: reason ?? null,
      normalizedCustomerId: fields.normalizedCustomerId,
      gmailMessageSubject: fields.gmailMessageSubject ?? null,
      acceptUrl: fields.acceptUrl ?? null,
      campaignsUrl: campaignsUrl ?? null,
      screenshotPath: fields.screenshotPath ?? null,
    };
  }

  private async log(fields: LogFields, status: GmailIntakeStatus, reason?: string): Promise<void> {
    await this.logRepository.create({
      source: fields.source,
      requestedCustomerId: fields.requestedCustomerId,
      normalizedCustomerId: fields.normalizedCustomerId,
      gmailMessageSubject: fields.gmailMessageSubject ?? null,
      gmailMatchedCustomerId: fields.gmailMatchedCustomerId ?? null,
      status,
      reason: reason ?? null,
      acceptUrl: fields.acceptUrl ?? null,
      adspowerProfileId: fields.adspowerProfileId ?? null,
      screenshotPath: fields.screenshotPath ?? null,
    });
  }
}
