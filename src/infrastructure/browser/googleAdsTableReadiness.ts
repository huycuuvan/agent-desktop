import type { Page } from "playwright";

export interface GoogleAdsTableReadinessConfig {
  actionDelayMs: number;
  tableTimeoutMs: number;
  settleDelayMs: number;
  stableChecks: number;
  stableIntervalMs: number;
}

export interface GoogleAdsTableReadinessResult {
  ready: boolean;
  reason?: string;
}

const TABLE_NOT_READY_TIMEOUT = "TABLE_NOT_READY_TIMEOUT";

// Common Google Ads loading/skeleton markers: busy/progress roles and grey
// shimmer bars. Deliberately excludes any generic `[class*="loading" i]` match —
// Google Ads' own Angular template permanently wraps every campaign-name cell in
// a `<div class="loading-indicator">` container that stays in the DOM (and stays
// visible) long after the data has loaded, so that pattern is a false positive
// here. The "placeholder rows with no real campaign link" case is instead
// covered precisely by isLoadingIndicatorVisible's settings-icon row check below.
const LOADING_INDICATOR_SELECTOR = ['[aria-busy="true"]', '[role="progressbar"]', '[class*="skeleton" i]', '[class*="shimmer" i]'].join(
  ", ",
);

interface TableSnapshot {
  rowCount: number;
  paginationText: string | null;
}

export class GoogleAdsTableReadinessWaiter {
  constructor(private readonly config: GoogleAdsTableReadinessConfig) {}

  /**
   * Waits until the campaigns table has actually finished loading rather than
   * reading it mid-render. A slow proxy can leave skeleton placeholders visible
   * for many seconds, during which row/pagination reads would wrongly report
   * zero results.
   */
  async waitForGoogleAdsTableReady(page: Page, options: { requireFilterChip: boolean }): Promise<GoogleAdsTableReadinessResult> {
    await page.waitForTimeout(this.config.actionDelayMs);

    const deadline = Date.now() + this.config.tableTimeoutMs;

    if (options.requireFilterChip && !(await this.waitUntilDeadline(page, deadline, () => this.isFilterChipVisible(page)))) {
      return { ready: false, reason: TABLE_NOT_READY_TIMEOUT };
    }

    if (!(await this.waitUntilDeadline(page, deadline, () => this.isTableVisible(page)))) {
      return { ready: false, reason: TABLE_NOT_READY_TIMEOUT };
    }

    if (!(await this.waitUntilDeadline(page, deadline, async () => !(await this.isLoadingIndicatorVisible(page))))) {
      return { ready: false, reason: TABLE_NOT_READY_TIMEOUT };
    }

    if (!(await this.waitForStableSnapshot(page, deadline))) {
      return { ready: false, reason: TABLE_NOT_READY_TIMEOUT };
    }

    await page.waitForTimeout(this.config.settleDelayMs);
    return { ready: true };
  }

  /**
   * Lighter-weight than waitForGoogleAdsTableReady: used after a scroll action
   * (not a refresh/filter action) to let newly-rendered rows settle without
   * paying the full settle delay each time.
   */
  async waitForLoadingToClear(page: Page, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return this.waitUntilDeadline(page, deadline, async () => !(await this.isLoadingIndicatorVisible(page)));
  }

  private async waitForStableSnapshot(page: Page, deadline: number): Promise<boolean> {
    let previous: TableSnapshot | null = null;
    let stableCount = 0;

    while (Date.now() < deadline) {
      // Loading can resume between checks (e.g. a second network round trip); if it
      // does, the stability streak no longer reflects settled data, so reset it.
      if (await this.isLoadingIndicatorVisible(page)) {
        stableCount = 0;
        previous = null;
        await page.waitForTimeout(this.config.stableIntervalMs);
        continue;
      }

      const current = await this.readSnapshot(page);
      if (previous && current.rowCount === previous.rowCount && current.paginationText === previous.paginationText) {
        stableCount += 1;
      } else {
        stableCount = 1;
      }
      previous = current;

      if (stableCount >= this.config.stableChecks) {
        return true;
      }

      await page.waitForTimeout(this.config.stableIntervalMs);
    }

    return false;
  }

  private async readSnapshot(page: Page): Promise<TableSnapshot> {
    const rowCount = await page.locator('[role="row"]:has([role="gridcell"])').count().catch(() => 0);
    const paginationLocator = page.getByText(/of\s+\d+/i).first();
    const paginationText =
      (await paginationLocator.count().catch(() => 0)) > 0 ? await paginationLocator.innerText().catch(() => null) : null;
    return { rowCount, paginationText };
  }

  private async isFilterChipVisible(page: Page): Promise<boolean> {
    return page.getByText(/contains/i).first().isVisible().catch(() => false);
  }

  private async isTableVisible(page: Page): Promise<boolean> {
    return page.locator('[role="grid"], [role="table"], [role="row"]').first().isVisible().catch(() => false);
  }

  private async isLoadingIndicatorVisible(page: Page): Promise<boolean> {
    if (await page.locator(LOADING_INDICATOR_SELECTOR).first().isVisible().catch(() => false)) {
      return true;
    }
    // A campaign row with a real campaign has a "settings" gear icon next to its
    // name link; rows still rendering only placeholder blocks won't have it yet,
    // and "No campaigns match your filters" only appears once loading is done.
    const hasAnyRow = (await page.locator('[role="row"]:has([role="gridcell"])').count().catch(() => 0)) > 0;
    if (!hasAnyRow) {
      return false;
    }
    const hasRealRow = await page.locator('[role="row"]:has([role="gridcell"])').filter({ hasText: "settings" }).count().catch(() => 0);
    const hasEmptyState = await page.getByText(/No campaigns match your filters/i).first().isVisible().catch(() => false);
    const hasPagination = (await page.getByText(/of\s+\d+/i).first().count().catch(() => 0)) > 0;
    return hasRealRow === 0 && !hasEmptyState && !hasPagination;
  }

  private async waitUntilDeadline(page: Page, deadline: number, predicate: () => Promise<boolean>): Promise<boolean> {
    while (Date.now() < deadline) {
      if (await predicate()) {
        return true;
      }
      await page.waitForTimeout(this.config.stableIntervalMs);
    }
    return false;
  }
}
