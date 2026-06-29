import type { AccountSnapshot, CampaignSnapshot, CollectorRun, PrismaClient } from "@prisma/client";
import type { SnapshotRepository } from "../../domain/repositories/SnapshotRepository.js";
import type { CollectorRunInput, CollectorRunSummary } from "../../domain/entities/CollectorRunSnapshot.js";
import type { RunWithCampaigns } from "../../domain/entities/CampaignDiff.js";

type CollectorRunWithSnapshots = CollectorRun & {
  accountSnapshots: (AccountSnapshot & { campaignSnapshots: CampaignSnapshot[] })[];
};

export class PrismaSnapshotRepository implements SnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveRun(run: CollectorRunInput): Promise<number> {
    const collectorRun = await this.prisma.collectorRun.create({
      data: {
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        providerCode: run.providerCode,
        dateMode: run.dateMode,
        rawJson: run.rawJson,
      },
    });

    for (const account of run.accounts) {
      const accountSnapshot = await this.prisma.accountSnapshot.create({
        data: {
          runId: collectorRun.id,
          accountName: account.accountName,
          customerId: account.customerId,
          keyword: account.keyword,
          refreshed: account.refreshed,
          filterChipFound: account.filterChipFound,
          visibleRowCount: account.visibleRowCount,
          totalFilteredRows: account.totalFilteredRows,
          campaignsCollected: account.campaignsCollected,
          campaignsMissing: account.campaignsMissing,
          reason: account.reason,
          screenshotPath: account.screenshotPath,
          fromDate: account.fromDate,
          toDate: account.toDate,
          googleAdsDateLabel: account.googleAdsDateLabel,
        },
      });

      if (account.campaigns.length > 0) {
        await this.prisma.campaignSnapshot.createMany({
          data: account.campaigns.map((campaign) => ({
            accountSnapshotId: accountSnapshot.id,
            campaignKey: campaign.campaignKey,
            campaignName: campaign.campaignName,
            budget: campaign.budget,
            status: campaign.status,
            optimizationScore: campaign.optimizationScore,
            account: campaign.account,
            campaignType: campaign.campaignType,
            impressions: campaign.impressions,
            interactions: campaign.interactions,
            interactionRate: campaign.interactionRate,
            avgCost: campaign.avgCost,
            cost: campaign.cost,
            conversions: campaign.conversions,
          })),
        });
      }
    }

    return collectorRun.id;
  }

  async getLatestRunSummary(): Promise<CollectorRunSummary | null> {
    const latestRun = await this.prisma.collectorRun.findFirst({
      orderBy: { id: "desc" },
      include: { accountSnapshots: { include: { campaignSnapshots: true } } },
    });

    if (!latestRun) {
      return null;
    }

    const accountsCount = latestRun.accountSnapshots.length;
    const campaignsCount = latestRun.accountSnapshots.reduce(
      (sum, account) => sum + account.campaignSnapshots.length,
      0,
    );
    const failedAccountsCount = latestRun.accountSnapshots.filter((account) => account.reason !== null).length;

    return {
      runId: latestRun.id,
      accountsCount,
      campaignsCount,
      failedAccountsCount,
    };
  }

  async getLatestRunWithCampaigns(): Promise<RunWithCampaigns | null> {
    const run = await this.prisma.collectorRun.findFirst({
      orderBy: { id: "desc" },
      include: { accountSnapshots: { include: { campaignSnapshots: true } } },
    });

    return run ? this.toRunWithCampaigns(run) : null;
  }

  async getLatestComparableRun(latestRun: RunWithCampaigns): Promise<RunWithCampaigns | null> {
    const candidates = await this.prisma.collectorRun.findMany({
      where: {
        providerCode: latestRun.providerCode,
        dateMode: latestRun.dateMode,
        id: { lt: latestRun.runId },
      },
      orderBy: { id: "desc" },
      include: { accountSnapshots: { include: { campaignSnapshots: true } } },
    });

    for (const candidate of candidates) {
      const flattened = this.toRunWithCampaigns(candidate);
      if (flattened.fromDate === latestRun.fromDate && flattened.toDate === latestRun.toDate) {
        return flattened;
      }
    }

    return null;
  }

  private toRunWithCampaigns(run: CollectorRunWithSnapshots): RunWithCampaigns {
    const fromDate = run.accountSnapshots[0]?.fromDate ?? null;
    const toDate = run.accountSnapshots[0]?.toDate ?? null;

    const campaigns = run.accountSnapshots.flatMap((account) =>
      account.campaignSnapshots.map((campaign) => ({
        campaignKey: campaign.campaignKey,
        campaignName: campaign.campaignName,
        account: campaign.account,
        customerId: account.customerId,
        status: campaign.status,
        budget: campaign.budget,
        cost: campaign.cost,
        impressions: campaign.impressions,
        interactions: campaign.interactions,
        conversions: campaign.conversions,
      })),
    );

    return {
      runId: run.id,
      providerCode: run.providerCode,
      dateMode: run.dateMode,
      fromDate,
      toDate,
      campaigns,
    };
  }
}
