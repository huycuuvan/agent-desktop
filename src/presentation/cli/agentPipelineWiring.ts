import { env } from "../../infrastructure/config/env.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { GoogleAdsCollectorRunner } from "../../infrastructure/collector/GoogleAdsCollectorRunner.js";
import { SheetsClient } from "../../infrastructure/sheets/SheetsClient.js";
import { SnapshotSheetsSyncer } from "../../infrastructure/sheets/SnapshotSheetsSyncer.js";
import { AgentPipelineUseCase } from "../../domain/usecases/AgentPipelineUseCase.js";
import { logger } from "../../infrastructure/logger/logger.js";
import type { SheetsSyncer } from "../../domain/repositories/SheetsSyncer.js";

const SCREENSHOT_DIR = "storage/screenshots";

export interface AgentPipelineWiring {
  pipeline: AgentPipelineUseCase;
  snapshotRepository: PrismaSnapshotRepository;
}

/**
 * Builds a one-shot AgentPipelineUseCase (notifier=null — the caller is
 * responsible for sending its own summary message).
 *
 * Reused by both `pnpm agent:start` (via agentStart.ts) and the Telegram
 * orchestration flow (telegramBot.ts).
 */
export function buildAgentPipelineUseCase(): AgentPipelineWiring {
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
      "GOOGLE_SHEETS_SPREADSHEET_ID/GOOGLE_SHEETS_CREDENTIALS_PATH not set — pipeline will run collector + snapshot only, skipping Sheets sync.",
    );
  }

  const pipeline = new AgentPipelineUseCase(
    collectorRunner,
    snapshotRepository,
    sheetsSyncer,
    null, // notifier — orchestration sends its own summary
    env.WATCH_PROVIDER_CODE,
    env.GOOGLE_ADS_DATE_MODE,
  );

  return { pipeline, snapshotRepository };
}

export { SCREENSHOT_DIR };
