import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { GoogleAdsCampaignCollector } from "../../domain/repositories/GoogleAdsCampaignCollector.js";
import type { AdsPowerProfile } from "../../domain/entities/AdsPowerProfile.js";
import type { GoogleAdsTab } from "../../domain/entities/GoogleAdsTab.js";
import type { GoogleAdsAccountReadResult } from "../../domain/entities/GoogleAdsAccountReadResult.js";
import type { GoogleAdsDateMode } from "../../domain/entities/GoogleAdsDateMode.js";
import { RefreshExecutor } from "./RefreshExecutor.js";
import { CampaignSearchExecutor } from "./CampaignSearchExecutor.js";
import { CampaignTableReader } from "./CampaignTableReader.js";
import { GoogleAdsDateRangeExecutor } from "./GoogleAdsDateRangeExecutor.js";
import { GoogleAdsTableReadinessWaiter } from "./googleAdsTableReadiness.js";
import { logger } from "../logger/logger.js";

const PAGE_NOT_FOUND = "PAGE_NOT_FOUND";
const COLLECT_FAILED = "COLLECT_FAILED";

export interface GoogleAdsCollectorConfig {
  scrollOverallTimeoutMs: number;
  scrollPerStepWaitMs: number;
}

export class GoogleAdsCollector implements GoogleAdsCampaignCollector {
  constructor(
    private readonly refreshExecutor: RefreshExecutor,
    private readonly dateRangeExecutor: GoogleAdsDateRangeExecutor,
    private readonly searchExecutor: CampaignSearchExecutor,
    private readonly tableReader: CampaignTableReader,
    private readonly readinessWaiter: GoogleAdsTableReadinessWaiter,
    private readonly screenshotDir: string,
    private readonly scrollConfig: GoogleAdsCollectorConfig,
  ) {}

  async collect(
    profile: AdsPowerProfile,
    tab: GoogleAdsTab,
    keyword: string,
    dateMode: GoogleAdsDateMode,
  ): Promise<GoogleAdsAccountReadResult> {
    const base: GoogleAdsAccountReadResult = {
      accountName: tab.accountName,
      customerId: tab.customerId,
      keyword,
      dateMode,
      googleAdsDateLabel: null,
      fromDate: null,
      toDate: null,
      refreshed: false,
      filterChipFound: false,
      visibleRowCount: 0,
      paginationText: null,
      totalFilteredRows: 0,
      campaignsCollected: 0,
      campaignsMissing: 0,
      campaigns: [],
    };

    let browser;
    try {
      browser = await chromium.connectOverCDP(profile.wsEndpoint);
      const page = this.findMatchingPage(browser, tab);

      if (!page) {
        return { ...base, reason: PAGE_NOT_FOUND };
      }

      await page.bringToFront();

      const refreshed = await this.refreshExecutor.refresh(page);
      const postRefreshReadiness = await this.readinessWaiter.waitForGoogleAdsTableReady(page, { requireFilterChip: false });
      if (!postRefreshReadiness.ready) {
        const screenshotPath = await this.captureScreenshot(page, tab.accountName, tab.customerId);
        return { ...base, refreshed, screenshotPath, reason: postRefreshReadiness.reason };
      }

      // Apply the date range before the provider-code filter, per the date
      // strategy: a wrong/default date window could otherwise exclude campaigns
      // before the filter even runs. A failure here is non-fatal — continue with
      // whatever date range was already active, but surface it via `reason`.
      const dateRangeOutcome = await this.dateRangeExecutor.applyDateRange(page, dateMode);
      const dateRangeReason = dateRangeOutcome.applied ? undefined : dateRangeOutcome.reason;
      if (dateRangeOutcome.applied) {
        await this.readinessWaiter.waitForGoogleAdsTableReady(page, { requireFilterChip: false });
      }

      const withDateRange: GoogleAdsAccountReadResult = {
        ...base,
        refreshed,
        googleAdsDateLabel: dateRangeOutcome.googleAdsDateLabel,
        fromDate: dateRangeOutcome.fromDate,
        toDate: dateRangeOutcome.toDate,
      };

      const searchOutcome = await this.searchExecutor.applyFilter(page, keyword);
      if (!searchOutcome.searchApplied) {
        const screenshotPath = await this.captureScreenshot(page, tab.accountName, tab.customerId);
        return { ...withDateRange, screenshotPath, reason: searchOutcome.reason ?? dateRangeReason };
      }

      const postFilterReadiness = await this.readinessWaiter.waitForGoogleAdsTableReady(page, { requireFilterChip: true });
      if (!postFilterReadiness.ready) {
        const screenshotPath = await this.captureScreenshot(page, tab.accountName, tab.customerId);
        return {
          ...withDateRange,
          filterChipFound: searchOutcome.filterChipFound,
          screenshotPath,
          reason: postFilterReadiness.reason ?? dateRangeReason,
        };
      }

      const { paginationText, totalFilteredRows } = await this.tableReader.readPagination(page);
      const campaigns =
        totalFilteredRows > 0
          ? await this.tableReader.readAllCampaignRows(page, {
              totalFilteredRows,
              overallTimeoutMs: this.scrollConfig.scrollOverallTimeoutMs,
              perScrollWaitMs: this.scrollConfig.scrollPerStepWaitMs,
            })
          : [];
      const screenshotPath = await this.captureScreenshot(page, tab.accountName, tab.customerId);

      return {
        ...withDateRange,
        filterChipFound: searchOutcome.filterChipFound,
        visibleRowCount: campaigns.length,
        paginationText,
        totalFilteredRows,
        campaignsCollected: campaigns.length,
        campaignsMissing: Math.max(0, totalFilteredRows - campaigns.length),
        campaigns,
        screenshotPath,
        reason: dateRangeReason,
      };
    } catch (error) {
      logger.warn({ customerId: tab.customerId, err: error }, "Failed to collect Google Ads campaigns");
      return { ...base, reason: COLLECT_FAILED };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  private findMatchingPage(browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>, tab: GoogleAdsTab): Page | undefined {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url() === tab.url) {
          return page;
        }
      }
    }
    return undefined;
  }

  private async captureScreenshot(page: Page, accountName: string | undefined, customerId: string | undefined): Promise<string> {
    await mkdir(this.screenshotDir, { recursive: true });
    const safeAccountName = (accountName ?? "unknown_account").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const safeCustomerId = customerId ?? "unknown_customer";
    const fileName = `${safeAccountName}_${safeCustomerId}_${Date.now()}.png`;
    const screenshotPath = path.join(this.screenshotDir, fileName);
    await page.screenshot({ path: screenshotPath });
    return screenshotPath;
  }
}
