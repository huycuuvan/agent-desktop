export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  reply_to_message?: TelegramMessage;
}

export class TelegramClient {
  constructor(private readonly botToken: string) {}

  async sendMessage(chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed: ${response.status} ${response.statusText} ${body}`);
    }
  }

  async getUpdates(offset?: number, timeoutSecs = 30): Promise<TelegramUpdate[]> {
    const url = new URL(`https://api.telegram.org/bot${this.botToken}/getUpdates`);
    if (offset !== undefined) url.searchParams.set("offset", String(offset));
    url.searchParams.set("timeout", String(timeoutSecs));
    url.searchParams.set("allowed_updates", '["message"]');

    const response = await fetch(url, { signal: AbortSignal.timeout((timeoutSecs + 5) * 1000) });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram getUpdates failed: ${response.status} ${response.statusText} ${body}`);
    }

    const json = (await response.json()) as { ok: boolean; result: TelegramUpdate[] };
    return json.result ?? [];
  }
}
