import type { CampaignRow } from "../entities/CampaignRow.js";

export function buildCampaignKey(customerId: string | null | undefined, row: CampaignRow): string {
  return [customerId ?? "", row.campaignName ?? "", row.account ?? ""].join("|");
}
