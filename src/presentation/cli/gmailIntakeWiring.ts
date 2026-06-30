import { env } from "../../infrastructure/config/env.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { AdsPowerProfileRepositoryImpl } from "../../infrastructure/adspower/AdsPowerProfileRepositoryImpl.js";
import { GmailWebSearchExecutor } from "../../infrastructure/browser/GmailWebSearchExecutor.js";
import { GmailAcceptExecutor } from "../../infrastructure/browser/GmailAcceptExecutor.js";
import { GoogleAdsOpenExecutor } from "../../infrastructure/browser/GoogleAdsOpenExecutor.js";
import { PrismaGmailIntakeLogRepository } from "../../infrastructure/db/PrismaGmailIntakeLogRepository.js";
import { GmailIntakeUseCase } from "../../domain/usecases/GmailIntakeUseCase.js";

const SCREENSHOT_DIR = "storage/screenshots";

export function buildGmailIntakeUseCase(): GmailIntakeUseCase {
  const profileRepository = new AdsPowerProfileRepositoryImpl(
    env.ADSPOWER_API_BASE_URL,
    env.ADSPOWER_API_KEY,
  );

  const searcher = new GmailWebSearchExecutor(
    profileRepository,
    env.GMAIL_SEARCH_TIMEOUT_MS,
    SCREENSHOT_DIR,
    env.DEFAULT_ADSPOWER_PROFILE_ID,
  );

  const accepter = new GmailAcceptExecutor(
    env.GMAIL_ACCEPT_TIMEOUT_MS,
    SCREENSHOT_DIR,
    env.GMAIL_ACCEPT_PAGE_TIMEOUT_MS,
    env.GMAIL_ACCEPT_SETTLE_DELAY_MS,
    env.GMAIL_CAMPAIGNS_PAGE_TIMEOUT_MS,
    env.GMAIL_CAMPAIGNS_SETTLE_DELAY_MS,
  );
  const adsOpener = new GoogleAdsOpenExecutor();
  const logRepository = new PrismaGmailIntakeLogRepository(prisma);

  return new GmailIntakeUseCase(searcher, accepter, adsOpener, logRepository, env.GMAIL_WEB_INTAKE_ENABLED);
}
