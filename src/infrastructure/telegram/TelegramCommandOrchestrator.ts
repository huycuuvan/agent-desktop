import type { TelegramClient } from "./TelegramClient.js";
import type { TelegramOrchestrationUseCase } from "../../domain/usecases/TelegramOrchestrationUseCase.js";
import {
  formatSearchingMessage,
  formatIntakeResultMessage,
  formatCollectingMessage,
  formatPipelineCompletedMessage,
  formatPipelineErrorMessage,
} from "../../domain/services/TelegramOrchestrationFormatter.js";
import { createRunGuard } from "../../domain/services/runGuard.js";
import { logger } from "../logger/logger.js";

export class TelegramCommandOrchestrator {
  private readonly guard = createRunGuard(() =>
    this.runImpl(this._pendingCustomerId!, this._pendingReplyTo!),
  );
  private _pendingCustomerId: string | null = null;
  private _pendingReplyTo: string | null = null;

  constructor(
    private readonly orchestrationUseCase: TelegramOrchestrationUseCase,
    private readonly client: TelegramClient,
  ) {}

  /**
   * Handles a /accept_mcc command end-to-end.
   * All replies go to `replyTo` (the chat the command came from).
   * Returns false if a run is already in progress.
   */
  async handle(customerId: string, replyTo: string): Promise<boolean> {
    if (this.guard.isRunning()) {
      logger.warn({ customerId }, "TelegramCommandOrchestrator: run already in progress, skipping");
      await this.send(replyTo, "⚠️ An orchestration run is already in progress. Please wait and try again.").catch(
        () => undefined,
      );
      return false;
    }

    this._pendingCustomerId = customerId;
    this._pendingReplyTo = replyTo;
    await this.send(replyTo, formatSearchingMessage(customerId)).catch(() => undefined);

    const result = await this.guard.runOrSkip();
    if (result === null) {
      return false;
    }
    return true;
  }

  private async runImpl(customerId: string, replyTo: string): Promise<void> {
    try {
      const orchResult = await this.orchestrationUseCase.run(customerId, "telegram", {
        onIntakeComplete: async (intakeResult) => {
          await this.send(replyTo, formatIntakeResultMessage(intakeResult));
        },
        onPipelineStart: async () => {
          await this.send(replyTo, formatCollectingMessage());
        },
      });

      switch (orchResult.outcome) {
        case "ORCHESTRATION_DISABLED":
        case "INTAKE_FAILED":
          // Already sent intake result via onIntakeComplete.
          break;

        case "PIPELINE_COMPLETED":
          await this.send(
            replyTo,
            formatPipelineCompletedMessage(orchResult.pipelineResult!, orchResult.diffSummary),
          );
          break;

        case "PIPELINE_ERROR":
          await this.send(replyTo, formatPipelineErrorMessage(orchResult.pipelineError ?? "Unknown error"));
          break;
      }
    } catch (error) {
      logger.error({ err: error, customerId }, "TelegramCommandOrchestrator: unexpected error");
      await this.send(replyTo, `Error processing ${customerId}: ${String(error)}`).catch(() => undefined);
    }
  }

  private async send(chatId: string, text: string): Promise<void> {
    try {
      await this.client.sendMessage(chatId, text);
    } catch (err) {
      logger.warn({ err }, "TelegramCommandOrchestrator: failed to send Telegram message");
    }
  }
}
