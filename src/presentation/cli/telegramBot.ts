import { env } from "../../infrastructure/config/env.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";
import { TelegramCommandListener } from "../../infrastructure/telegram/TelegramCommandListener.js";
import { TelegramCommandOrchestrator } from "../../infrastructure/telegram/TelegramCommandOrchestrator.js";
import { TelegramOrchestrationUseCase } from "../../domain/usecases/TelegramOrchestrationUseCase.js";
import { buildGmailIntakeUseCase } from "./gmailIntakeWiring.js";
import { buildAgentPipelineUseCase } from "./agentPipelineWiring.js";
import {
  formatPipelineCompletedMessage,
  formatPipelineErrorMessage,
} from "../../domain/services/TelegramOrchestrationFormatter.js";
import { compareCampaignSnapshots } from "../../domain/services/CampaignDiffEngine.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { logger } from "../../infrastructure/logger/logger.js";

async function main(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID. Set both in .env.");
    process.exitCode = 1;
    return;
  }

  const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const gmailIntakeUseCase = buildGmailIntakeUseCase();

  // Build the pipeline wiring once — reused by both orchestration and /check commands.
  const { pipeline, snapshotRepository } = buildAgentPipelineUseCase();

  let orchestrator: TelegramCommandOrchestrator | undefined;

  if (env.TELEGRAM_ORCHESTRATION_ENABLED) {
    logger.info("TELEGRAM_ORCHESTRATION_ENABLED=true — building pipeline wiring for orchestration");

    const orchestrationUseCase = new TelegramOrchestrationUseCase(
      gmailIntakeUseCase,
      pipeline,
      snapshotRepository,
      true,
    );

    orchestrator = new TelegramCommandOrchestrator(orchestrationUseCase, client);
  }

  /**
   * Part 10 — collector runner for /check / /check_now / /run_collector.
   * Runs the full Collector → Snapshot → Sheets → Diff pipeline without Gmail intake.
   */
  const collectorRunner = async (): Promise<string> => {
    const result = await pipeline.run(false);

    // Compute diff for the summary message.
    let diffSummary = null;
    try {
      const latest = await snapshotRepository.getLatestRunWithCampaigns();
      if (latest) {
        const previous = await snapshotRepository.getLatestComparableRun(latest);
        if (previous) {
          const { summary } = compareCampaignSnapshots(previous.campaigns, latest.campaigns);
          diffSummary = summary;
        }
      }
    } catch {
      // diff failure is non-fatal
    }

    return formatPipelineCompletedMessage(result, diffSummary);
  };

  const listener = new TelegramCommandListener(
    client,
    gmailIntakeUseCase,
    env.TELEGRAM_CHAT_ID,
    env.TELEGRAM_BOT_USERNAME,
    orchestrator,
    env.TELEGRAM_POLL_TIMEOUT_SECONDS,
    env.TELEGRAM_POLL_RETRY_DELAY_MS,
    collectorRunner,
  );

  logger.info(
    {
      orchestrationEnabled: env.TELEGRAM_ORCHESTRATION_ENABLED,
      gmailIntakeEnabled: env.GMAIL_WEB_INTAKE_ENABLED,
    },
    "telegram:bot started — listening for /accept_mcc, /check commands",
  );

  listener.start();

  const shutdown = async (): Promise<void> => {
    logger.info("telegram:bot shutting down");
    listener.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
