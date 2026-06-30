import type { PrismaClient } from "@prisma/client";
import type { GmailIntakeLogRepository } from "../../domain/repositories/GmailIntakeLogRepository.js";
import type { GmailIntakeLogInput } from "../../domain/entities/GmailInvitation.js";

export class PrismaGmailIntakeLogRepository implements GmailIntakeLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: GmailIntakeLogInput): Promise<void> {
    await this.prisma.gmailInvitationIntakeLog.create({
      data: {
        source: input.source,
        requestedCustomerId: input.requestedCustomerId,
        normalizedCustomerId: input.normalizedCustomerId ?? null,
        gmailMessageSubject: input.gmailMessageSubject ?? null,
        gmailMatchedCustomerId: input.gmailMatchedCustomerId ?? null,
        status: input.status,
        reason: input.reason ?? null,
        acceptUrl: input.acceptUrl ?? null,
        adspowerProfileId: input.adspowerProfileId ?? null,
        screenshotPath: input.screenshotPath ?? null,
      },
    });
  }
}
