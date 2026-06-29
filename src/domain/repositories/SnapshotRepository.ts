import type { CollectorRunInput, CollectorRunSummary } from "../entities/CollectorRunSnapshot.js";
import type { RunWithCampaigns } from "../entities/CampaignDiff.js";
import type { LatestRunForSheetsSync } from "../entities/SheetSync.js";

export interface SnapshotRepository {
  saveRun(run: CollectorRunInput): Promise<number>;
  getLatestRunSummary(): Promise<CollectorRunSummary | null>;
  getLatestRunWithCampaigns(): Promise<RunWithCampaigns | null>;
  getLatestComparableRun(latestRun: RunWithCampaigns): Promise<RunWithCampaigns | null>;
  getLatestRunForSheetsSync(): Promise<LatestRunForSheetsSync | null>;
}
