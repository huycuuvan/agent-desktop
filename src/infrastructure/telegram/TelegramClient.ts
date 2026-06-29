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
}
