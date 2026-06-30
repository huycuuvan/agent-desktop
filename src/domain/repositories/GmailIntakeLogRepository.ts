import type { GmailIntakeLogInput } from "../entities/GmailInvitation.js";

export interface GmailIntakeLogRepository {
  create(input: GmailIntakeLogInput): Promise<void>;
}
