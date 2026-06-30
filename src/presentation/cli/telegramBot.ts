import { env } from "../../infrastructure/config/env.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";
import { TelegramCommandListener } from "../../infrastructure/telegram/TelegramCommandListener.js";
import { buildGmailIntakeUseCase } from "./gmailIntakeWiring.js";
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

  const listener = new TelegramCommandListener(
    client,
    gmailIntakeUseCase,
    env.TELEGRAM_CHAT_ID,
    env.TELEGRAM_BOT_USERNAME,
  );

  logger.info("telegram:bot started — listening for /accept_mcc commands");
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
