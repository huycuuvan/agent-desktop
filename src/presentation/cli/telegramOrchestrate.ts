/**
 * pnpm telegram:orchestrate -- --mcc 362-758-7499 [--dry-run]
 *
 * One-shot orchestration: Gmail intake -> Collector -> Snapshot -> Sheets Sync,
 * with a Telegram summary at the end.  Does not start a long-running bot listener.
 */
import { env } from "../../infrastructure/config/env.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";
import { TelegramOrchestrationUseCase } from "../../domain/usecases/TelegramOrchestrationUseCase.js";
import {
  formatSearchingMessage,
  formatIntakeResultMessage,
  formatCollectingMessage,
  formatPipelineCompletedMessage,
  formatPipelineErrorMessage,
} from "../../domain/services/TelegramOrchestrationFormatter.js";
import { buildGmailIntakeUseCase } from "./gmailIntakeWiring.js";
import { buildAgentPipelineUseCase } from "./agentPipelineWiring.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { normalizeCustomerId } from "../../domain/services/customerIdParser.js";

function parseMccArg(): string | null {
  const idx = process.argv.indexOf("--mcc");
  return idx !== -1 && process.argv[idx + 1] ? (process.argv[idx + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const rawMcc = parseMccArg();
  if (!rawMcc) {
    console.error("Usage: pnpm telegram:orchestrate -- --mcc 362-758-7499");
    process.exitCode = 1;
    return;
  }

  const customerId = normalizeCustomerId(rawMcc);
  if (!customerId) {
    console.error(`Invalid customer ID: ${rawMcc}`);
    process.exitCode = 1;
    return;
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID. Set both in .env.");
    process.exitCode = 1;
    return;
  }

  const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const gmailIntakeUseCase = buildGmailIntakeUseCase();
  const { pipeline, snapshotRepository } = buildAgentPipelineUseCase();

  const orchestrationUseCase = new TelegramOrchestrationUseCase(
    gmailIntakeUseCase,
    pipeline,
    snapshotRepository,
    true, // always enabled when invoked directly
  );

  const send = async (text: string): Promise<void> => {
    console.log(`\n--- Telegram message ---\n${text}\n`);
    await client.sendMessage(env.TELEGRAM_CHAT_ID!, text);
  };

  await send(formatSearchingMessage(customerId));

  const result = await orchestrationUseCase.run(customerId, "cli:telegram:orchestrate", {
    onIntakeComplete: async (intakeResult) => {
      await send(formatIntakeResultMessage(intakeResult));
    },
    onPipelineStart: async () => {
      await send(formatCollectingMessage());
    },
  });

  switch (result.outcome) {
    case "PIPELINE_COMPLETED":
      await send(formatPipelineCompletedMessage(result.pipelineResult!, result.diffSummary));
      process.exitCode = 0;
      break;
    case "PIPELINE_ERROR":
      await send(formatPipelineErrorMessage(result.pipelineError ?? "Unknown error"));
      process.exitCode = 1;
      break;
    case "INTAKE_FAILED":
    case "ORCHESTRATION_DISABLED":
      // Messages already sent via onIntakeComplete
      process.exitCode = result.outcome === "INTAKE_FAILED" ? 1 : 0;
      break;
  }

  console.log("\nResult:", JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
