import { compareCampaignSnapshots } from "../../domain/services/CampaignDiffEngine.js";
import { formatTelegramMessage } from "../../domain/services/TelegramMessageFormatter.js";
import type { Notifier, NotificationResult } from "../../domain/repositories/Notifier.js";
import type { SnapshotRepository } from "../../domain/repositories/SnapshotRepository.js";
import type { TelegramClient } from "./TelegramClient.js";

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly snapshotRepository: SnapshotRepository,
    private readonly telegramClient: TelegramClient,
    private readonly chatId: string,
  ) {}

  async notifyLatestDiff(dryRun: boolean): Promise<NotificationResult> {
    const latestRunSummary = await this.snapshotRepository.getLatestRunSummary();
    const latestRun = await this.snapshotRepository.getLatestRunWithCampaigns();

    if (!latestRunSummary || !latestRun) {
      return { status: "NO_COMPARABLE_RUN", message: null, changeCount: 0 };
    }

    const previousRun = await this.snapshotRepository.getLatestComparableRun(latestRun);
    if (!previousRun) {
      return { status: "NO_COMPARABLE_RUN", message: null, changeCount: 0 };
    }

    const { summary, changes } = compareCampaignSnapshots(previousRun.campaigns, latestRun.campaigns);

    const message = formatTelegramMessage({
      providerCode: latestRun.providerCode,
      runId: latestRun.runId,
      accounts: latestRunSummary.accountsCount,
      campaigns: latestRunSummary.campaignsCount,
      summary,
      changes,
    });

    if (!message) {
      return { status: "NO_CHANGES", message: null, changeCount: 0 };
    }

    if (dryRun) {
      return { status: "DRY_RUN", message, changeCount: changes.length };
    }

    await this.telegramClient.sendMessage(this.chatId, message);
    return { status: "SENT", message, changeCount: changes.length };
  }
}
