import { env } from "../../infrastructure/config/env.js";
import { prisma } from "../../infrastructure/db/prismaClient.js";
import { PrismaSnapshotRepository } from "../../infrastructure/db/PrismaSnapshotRepository.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";
import { TelegramNotifier } from "../../infrastructure/telegram/TelegramNotifier.js";

async function main(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log(
      "Missing TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID. Set both in .env before running telegram:notify-latest.",
    );
    process.exitCode = 1;
    return;
  }

  const snapshotRepository = new PrismaSnapshotRepository(prisma);
  const telegramClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const notifier = new TelegramNotifier(snapshotRepository, telegramClient, env.TELEGRAM_CHAT_ID);

  const result = await notifier.notifyLatestDiff(false);

  console.log(JSON.stringify({ status: result.status, changeCount: result.changeCount }, null, 2));
  if (result.message) {
    console.log("\nMessage sent:\n");
    console.log(result.message);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
