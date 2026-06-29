import { env } from "../../infrastructure/config/env.js";
import { TelegramClient } from "../../infrastructure/telegram/TelegramClient.js";

async function main(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log("Missing TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID. Set both in .env before running telegram:test.");
    process.exitCode = 1;
    return;
  }

  const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const text = "Desktop Agent Telegram test OK";
  await client.sendMessage(env.TELEGRAM_CHAT_ID, text);
  console.log(`Sent: ${text}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
