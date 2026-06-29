import { env } from "../../infrastructure/config/env.js";
import { logger } from "../../infrastructure/logger/logger.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { GoogleAdsCollectorRunner } from "../../infrastructure/collector/GoogleAdsCollectorRunner.js";
import { SheetsClient } from "../../infrastructure/sheets/SheetsClient.js";
import { SnapshotSheetsSyncer } from "../../infrastructure/sheets/SnapshotSheetsSyncer.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";
import { TelegramNotifier } from "../../infrastructure/telegram/TelegramNotifier.js";
import { AgentScheduler } from "../../infrastructure/scheduler/AgentScheduler.js";
import { AgentPipelineUseCase } from "../../domain/usecases/AgentPipelineUseCase.js";
import { createRunGuard } from "../../domain/services/runGuard.js";
import type { SheetsSyncer } from "../../domain/repositories/SheetsSyncer.js";
import type { Notifier } from "../../domain/repositories/Notifier.js";
import type { PipelineRunSummary } from "../../domain/entities/PipelineRunSummary.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const collectorRunner = new GoogleAdsCollectorRunner();

  let sheetsSyncer: SheetsSyncer | null = null;
  if (env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SHEETS_CREDENTIALS_PATH) {
    const sheetsClient = new SheetsClient(env.GOOGLE_SHEETS_CREDENTIALS_PATH);
    sheetsSyncer = new SnapshotSheetsSyncer(
      snapshotRepository,
      sheetsClient,
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
      env.GOOGLE_SHEETS_TAB_NAME,
    );
  } else {
    logger.warn(
      "GOOGLE_SHEETS_SPREADSHEET_ID/GOOGLE_SHEETS_CREDENTIALS_PATH not set — agent will run collector + snapshot only, skipping Sheets sync.",
    );
  }

  let notifier: Notifier | null = null;
  if (env.TELEGRAM_NOTIFICATIONS_ENABLED) {
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const telegramClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
      notifier = new TelegramNotifier(snapshotRepository, telegramClient, env.TELEGRAM_CHAT_ID);
    } else {
      logger.warn(
        "TELEGRAM_NOTIFICATIONS_ENABLED=true but TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are not set — skipping Telegram notifications.",
      );
    }
  }

  const pipeline = new AgentPipelineUseCase(
    collectorRunner,
    snapshotRepository,
    sheetsSyncer,
    notifier,
    env.WATCH_PROVIDER_CODE,
    env.GOOGLE_ADS_DATE_MODE,
  );

  const guard = createRunGuard(() => pipeline.run(dryRun));

  const runAndLog = async (): Promise<void> => {
    const summary = await guard.runOrSkip();
    if (summary === null) {
      logger.warn("Skipped scheduled run: previous pipeline run is still in progress.");
      return;
    }
    logPipelineSummary(summary, dryRun);
  };

  logger.info(
    {
      schedulerEnabled: env.AGENT_SCHEDULER_ENABLED,
      intervalMinutes: env.AGENT_SCAN_INTERVAL_MINUTES,
      runOnStart: env.AGENT_RUN_ON_START,
      telegramNotificationsEnabled: env.TELEGRAM_NOTIFICATIONS_ENABLED,
      dryRun,
    },
    "Starting desktop-agent",
  );

  if (!env.AGENT_SCHEDULER_ENABLED) {
    logger.info(
      "AGENT_SCHEDULER_ENABLED=false — running once and exiting (no recurring schedule). Set AGENT_SCHEDULER_ENABLED=true in .env to keep the agent running on an interval.",
    );
    if (env.AGENT_RUN_ON_START) {
      await runAndLog();
    } else {
      logger.info("AGENT_RUN_ON_START=false and AGENT_SCHEDULER_ENABLED=false — nothing to run.");
    }
    await prisma.$disconnect();
    return;
  }

  const scheduler = new AgentScheduler(runAndLog, {
    intervalMs: env.AGENT_SCAN_INTERVAL_MINUTES * 60_000,
    runOnStart: env.AGENT_RUN_ON_START,
  });

  await scheduler.start();
  logger.info(`Scheduler running — pipeline will run every ${env.AGENT_SCAN_INTERVAL_MINUTES} minute(s). Press Ctrl+C to stop.`);

  const shutdown = (): void => {
    scheduler.stop();
    prisma.$disconnect().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function logPipelineSummary(summary: PipelineRunSummary, dryRun: boolean): void {
  logger.info(
    {
      collectorRunId: summary.collectorRunId,
      accounts: summary.accounts,
      campaigns: summary.campaigns,
      failedAccounts: summary.failedAccounts,
      sheetsAppendedRows: summary.sheetsAppendedRows,
      sheetsUpdatedRows: summary.sheetsUpdatedRows,
      sheetsSkippedRows: summary.sheetsSkippedRows,
      notificationStatus: summary.notificationStatus,
      durationMs: summary.durationMs,
      status: summary.status,
      dryRun,
      ...(summary.error ? { error: summary.error } : {}),
      ...(summary.notificationError ? { notificationError: summary.notificationError } : {}),
    },
    "Pipeline run summary",
  );

  if (dryRun && summary.notificationStatus === "DRY_RUN" && summary.notificationMessage) {
    console.log("\nPlanned Telegram message (dry-run, not sent):\n");
    console.log(summary.notificationMessage);
  }
}

main().catch((error) => {
  logger.error({ err: error }, "agent:start failed");
  process.exitCode = 1;
});
