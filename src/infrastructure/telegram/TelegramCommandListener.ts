import { TelegramClient, type TelegramMessage } from "./TelegramClient.js";
import type { GmailIntakeUseCase } from "../../domain/usecases/GmailIntakeUseCase.js";
import { parseAcceptMccCommand } from "../../domain/services/telegramCommandParser.js";
import { logger } from "../logger/logger.js";

function formatResult(result: Awaited<ReturnType<GmailIntakeUseCase["acceptInvitation"]>>): string {
  const lines: string[] = [`Status: ${result.status}`];
  if (result.normalizedCustomerId) lines.push(`Customer ID: ${result.normalizedCustomerId}`);
  if (result.reason) lines.push(`Reason: ${result.reason}`);
  if (result.gmailMessageSubject) lines.push(`Email: ${result.gmailMessageSubject}`);
  if (result.acceptUrl) lines.push(`Accept URL: ${result.acceptUrl}`);
  if (result.campaignsUrl) lines.push(`Campaigns: ${result.campaignsUrl}`);
  return lines.join("\n");
}

function isRelevantMessage(msg: TelegramMessage, botUsername?: string): boolean {
  const text = msg.text?.trim() ?? "";
  if (!text) return false;
  if (/^\/accept_mcc\b/i.test(text)) return true;
  if (botUsername && text.toLowerCase().startsWith(`@${botUsername.toLowerCase()}`)) return true;
  return false;
}

export class TelegramCommandListener {
  private offset: number | undefined;
  private running = false;

  constructor(
    private readonly client: TelegramClient,
    private readonly gmailIntakeUseCase: GmailIntakeUseCase,
    private readonly chatId: string,
    private readonly botUsername?: string,
  ) {}

  start(): void {
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, 30);

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (!update.message) continue;

          const msg = update.message;
          const chatIdStr = String(msg.chat.id);

          if (chatIdStr !== this.chatId) continue;
          if (!isRelevantMessage(msg, this.botUsername)) continue;

          void this.handleCommand(msg).catch((err) =>
            logger.error({ err }, "TelegramCommandListener: unhandled error in handleCommand"),
          );
        }
      } catch (error) {
        logger.warn({ err: error }, "TelegramCommandListener: getUpdates error, retrying in 5s");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async handleCommand(msg: TelegramMessage): Promise<void> {
    const text = msg.text?.trim() ?? "";
    const repliedToText = msg.reply_to_message?.text ?? null;

    const parsed = parseAcceptMccCommand({ text, repliedToText });

    if ("error" in parsed) {
      logger.info({ text }, "TelegramCommandListener: no customer id found in command");
      await this.client.sendMessage(
        this.chatId,
        "Could not parse a Google Ads Customer ID.\nUsage: /accept_mcc 537-706-1556",
      );
      return;
    }

    const { customerId } = parsed;
    logger.info({ customerId }, "TelegramCommandListener: accepting invitation");

    await this.client.sendMessage(this.chatId, `Searching for invitation: ${customerId}…`);

    try {
      const result = await this.gmailIntakeUseCase.acceptInvitation(customerId, "telegram");
      await this.client.sendMessage(this.chatId, formatResult(result));
    } catch (error) {
      logger.error({ err: error }, "TelegramCommandListener: GmailIntakeUseCase failed");
      await this.client.sendMessage(this.chatId, `Error processing ${customerId}: ${String(error)}`);
    }
  }
}
