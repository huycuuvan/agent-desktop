import { TelegramClient, type TelegramMessage } from "./TelegramClient.js";
import type { TelegramCommandOrchestrator } from "./TelegramCommandOrchestrator.js";
import type { GmailIntakeUseCase } from "../../domain/usecases/GmailIntakeUseCase.js";
import {
  parseAcceptMccCommand,
  isAcceptMccCommand,
  isCheckCommand,
  isWhoamiCommand,
} from "../../domain/services/telegramCommandParser.js";
import { isFetchTimeoutError } from "./telegramErrors.js";
import { logger } from "../logger/logger.js";

function formatIntakeResult(result: Awaited<ReturnType<GmailIntakeUseCase["acceptInvitation"]>>): string {
  const lines: string[] = [`Status: ${result.status}`];
  if (result.normalizedCustomerId) lines.push(`Customer ID: ${result.normalizedCustomerId}`);
  if (result.reason) lines.push(`Reason: ${result.reason}`);
  if (result.gmailMessageSubject) lines.push(`Email: ${result.gmailMessageSubject}`);
  if (result.acceptUrl) lines.push(`Accept URL: ${result.acceptUrl}`);
  if (result.campaignsUrl) lines.push(`Campaigns: ${result.campaignsUrl}`);
  return lines.join("\n");
}

/**
 * Returns true when the message should be handled by this listener.
 *
 * Handled commands (private chat, group, or mention):
 *   /accept_mcc [id]             — format 1
 *   /accept_mcc@botname [id]     — format 2 (Telegram group suffix)
 *   @botname /accept_mcc [id]    — format 3 (mention-then-command)
 *   @botname [id]                — bare mention with id
 *   /check, /check_now, /run_collector (+ optional @botname suffix)
 *   /whoami (+ optional @botname suffix)
 */
function isRelevantMessage(msg: TelegramMessage): boolean {
  const text = msg.text?.trim() ?? "";
  if (!text) return false;
  if (isAcceptMccCommand(text)) return true;
  if (isCheckCommand(text)) return true;
  if (isWhoamiCommand(text)) return true;
  return false;
}

export type CollectorRunner = () => Promise<string>;

export class TelegramCommandListener {
  private offset: number | undefined;
  private running = false;

  constructor(
    private readonly client: TelegramClient,
    private readonly gmailIntakeUseCase: GmailIntakeUseCase,
    /** Used only for proactive pipeline-summary messages (not command replies). */
    private readonly notificationChatId: string,
    private readonly botUsername?: string,
    /** When provided, handles the full orchestration flow (Phase 7). */
    private readonly orchestrator?: TelegramCommandOrchestrator,
    /** Seconds passed to Telegram's long-poll `timeout` param (default 30). */
    private readonly pollTimeoutSeconds: number = 30,
    /** Milliseconds to wait after a real network/API error before retrying (default 5000). */
    private readonly pollRetryDelayMs: number = 5000,
    /**
     * When provided, /check / /check_now / /run_collector commands run the
     * collector pipeline and send the summary to Telegram.
     */
    private readonly collectorRunner?: CollectorRunner,
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
        const updates = await this.client.getUpdates(this.offset, this.pollTimeoutSeconds);

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (!update.message) continue;

          const msg = update.message;

          if (!isRelevantMessage(msg)) continue;

          void this.handleCommand(msg).catch((err) =>
            logger.error({ err }, "TelegramCommandListener: unhandled error in handleCommand"),
          );
        }
      } catch (error) {
        if (isFetchTimeoutError(error)) {
          logger.debug("TelegramCommandListener: getUpdates timeout/no updates, polling again");
        } else {
          logger.warn({ err: error }, "TelegramCommandListener: getUpdates error, retrying");
          await new Promise((resolve) => setTimeout(resolve, this.pollRetryDelayMs));
        }
      }
    }
  }

  private async handleCommand(msg: TelegramMessage): Promise<void> {
    // Always reply to the chat the command came from.
    const replyTo = String(msg.chat.id);
    const text = msg.text?.trim() ?? "";
    const repliedToText = msg.reply_to_message?.text ?? null;

    logger.info(
      { chatId: replyTo, chatType: msg.chat.type, text: text.slice(0, 80) },
      "TelegramCommandListener: handling command",
    );

    // /whoami — diagnostic command, works from any chat
    if (isWhoamiCommand(text)) {
      await this.client
        .sendMessage(replyTo, `Chat ID: ${replyTo}\nChat type: ${msg.chat.type}`)
        .catch(() => undefined);
      return;
    }

    // /check / /check_now / /run_collector
    if (isCheckCommand(text)) {
      await this.handleCheckCommand(replyTo);
      return;
    }

    // /accept_mcc (all three formats)
    const parsed = parseAcceptMccCommand({ text, repliedToText });

    if ("error" in parsed) {
      logger.info({ text }, "TelegramCommandListener: no customer id found in command");
      await this.client
        .sendMessage(
          replyTo,
          "Could not parse a Google Ads Customer ID.\nUsage: /accept_mcc 537-706-1556",
        )
        .catch(() => undefined);
      return;
    }

    const { customerId } = parsed;
    logger.info({ customerId, chatId: replyTo }, "TelegramCommandListener: received accept_mcc command");

    // Phase 7 orchestration path — handles all messaging internally.
    if (this.orchestrator) {
      await this.orchestrator.handle(customerId, replyTo);
      return;
    }

    // Phase 6 fallback path — intake only.
    await this.client
      .sendMessage(replyTo, `Searching for invitation: ${customerId}…`)
      .catch(() => undefined);

    try {
      const result = await this.gmailIntakeUseCase.acceptInvitation(customerId, "telegram");
      await this.client.sendMessage(replyTo, formatIntakeResult(result)).catch(() => undefined);
    } catch (error) {
      logger.error({ err: error }, "TelegramCommandListener: GmailIntakeUseCase failed");
      await this.client
        .sendMessage(replyTo, `Error processing ${customerId}: ${String(error)}`)
        .catch(() => undefined);
    }
  }

  private async handleCheckCommand(replyTo: string): Promise<void> {
    logger.info({ chatId: replyTo }, "TelegramCommandListener: received check/run_collector command");

    if (!this.collectorRunner) {
      logger.warn("TelegramCommandListener: no collectorRunner configured for /check command");
      await this.client
        .sendMessage(replyTo, "⚠️ Collector runner is not configured on this bot instance.")
        .catch(() => undefined);
      return;
    }

    await this.client.sendMessage(replyTo, "Running collector…").catch(() => undefined);

    try {
      const summary = await this.collectorRunner();
      await this.client.sendMessage(replyTo, summary).catch(() => undefined);
    } catch (error) {
      logger.error({ err: error }, "TelegramCommandListener: collectorRunner failed");
      await this.client
        .sendMessage(replyTo, `Collector failed ❌\n\nError: ${String(error)}`)
        .catch(() => undefined);
    }
  }
}
