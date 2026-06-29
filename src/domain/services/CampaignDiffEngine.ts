import type {
  CampaignChange,
  CampaignDiffResult,
  CampaignDiffSummary,
  FlatCampaignSnapshot,
} from "../entities/CampaignDiff.js";

function metricsKey(campaign: FlatCampaignSnapshot): string {
  return JSON.stringify({
    impressions: campaign.impressions,
    interactions: campaign.interactions,
    conversions: campaign.conversions,
  });
}

export function compareCampaignSnapshots(
  previous: FlatCampaignSnapshot[],
  latest: FlatCampaignSnapshot[],
): CampaignDiffResult {
  const previousByKey = new Map(previous.map((campaign) => [campaign.campaignKey, campaign]));
  const latestByKey = new Map(latest.map((campaign) => [campaign.campaignKey, campaign]));
  const changes: CampaignChange[] = [];

  for (const campaign of latest) {
    if (!previousByKey.has(campaign.campaignKey)) {
      changes.push({
        type: "NEW_CAMPAIGN",
        campaignKey: campaign.campaignKey,
        campaignName: campaign.campaignName,
        account: campaign.account,
        customerId: campaign.customerId,
        before: null,
        after: null,
      });
    }
  }

  for (const campaign of previous) {
    if (!latestByKey.has(campaign.campaignKey)) {
      changes.push({
        type: "REMOVED_CAMPAIGN",
        campaignKey: campaign.campaignKey,
        campaignName: campaign.campaignName,
        account: campaign.account,
        customerId: campaign.customerId,
        before: null,
        after: null,
      });
    }
  }

  for (const latestCampaign of latest) {
    const previousCampaign = previousByKey.get(latestCampaign.campaignKey);
    if (!previousCampaign) {
      continue;
    }

    if (previousCampaign.status !== latestCampaign.status) {
      changes.push({
        type: "STATUS_CHANGED",
        campaignKey: latestCampaign.campaignKey,
        campaignName: latestCampaign.campaignName,
        account: latestCampaign.account,
        customerId: latestCampaign.customerId,
        before: previousCampaign.status,
        after: latestCampaign.status,
      });
    }

    if (previousCampaign.budget !== latestCampaign.budget) {
      changes.push({
        type: "BUDGET_CHANGED",
        campaignKey: latestCampaign.campaignKey,
        campaignName: latestCampaign.campaignName,
        account: latestCampaign.account,
        customerId: latestCampaign.customerId,
        before: previousCampaign.budget,
        after: latestCampaign.budget,
      });
    }

    if (previousCampaign.cost !== latestCampaign.cost) {
      changes.push({
        type: "COST_CHANGED",
        campaignKey: latestCampaign.campaignKey,
        campaignName: latestCampaign.campaignName,
        account: latestCampaign.account,
        customerId: latestCampaign.customerId,
        before: previousCampaign.cost,
        after: latestCampaign.cost,
      });
    }

    if (
      previousCampaign.impressions !== latestCampaign.impressions ||
      previousCampaign.interactions !== latestCampaign.interactions ||
      previousCampaign.conversions !== latestCampaign.conversions
    ) {
      changes.push({
        type: "METRIC_CHANGED",
        campaignKey: latestCampaign.campaignKey,
        campaignName: latestCampaign.campaignName,
        account: latestCampaign.account,
        customerId: latestCampaign.customerId,
        before: metricsKey(previousCampaign),
        after: metricsKey(latestCampaign),
      });
    }
  }

  return { summary: buildSummary(changes), changes };
}

function buildSummary(changes: CampaignChange[]): CampaignDiffSummary {
  return {
    newCampaigns: changes.filter((change) => change.type === "NEW_CAMPAIGN").length,
    removedCampaigns: changes.filter((change) => change.type === "REMOVED_CAMPAIGN").length,
    statusChanged: changes.filter((change) => change.type === "STATUS_CHANGED").length,
    budgetChanged: changes.filter((change) => change.type === "BUDGET_CHANGED").length,
    costChanged: changes.filter((change) => change.type === "COST_CHANGED").length,
    metricChanged: changes.filter((change) => change.type === "METRIC_CHANGED").length,
  };
}
