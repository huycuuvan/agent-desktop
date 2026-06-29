import type { Page } from "playwright";
import type { CampaignRow } from "../../domain/entities/CampaignRow.js";
import { buildHeaderIndexMap, mergeCampaignRows, parseCampaignRow, parsePaginationText } from "../../domain/services/campaignRowParser.js";
import { GoogleAdsTableReadinessWaiter } from "./googleAdsTableReadiness.js";

const DATA_ROW_SELECTOR = '[role="row"]:has([role="gridcell"])';
const MAX_NO_NEW_ROW_SCROLLS = 3;

export interface ReadAllCampaignRowsOptions {
  totalFilteredRows: number;
  overallTimeoutMs: number;
  perScrollWaitMs: number;
}

export class CampaignTableReader {
  constructor(private readonly readinessWaiter: GoogleAdsTableReadinessWaiter) {}

  async readPagination(page: Page): Promise<{ paginationText: string | null; totalFilteredRows: number }> {
    const paginationLocator = page.getByText(/of\s+\d+/i).first();
    const rawText = (await paginationLocator.count()) > 0 ? await paginationLocator.innerText().catch(() => null) : null;
    return parsePaginationText(rawText);
  }

  async readCampaignRows(page: Page): Promise<CampaignRow[]> {
    const headerIndexMap = await this.readHeaderIndexMap(page);
    const rowLocator = this.dataRowLocator(page);
    const rowCount = await rowLocator.count();

    const rows: CampaignRow[] = [];
    for (let index = 0; index < rowCount; index += 1) {
      const row = rowLocator.nth(index);
      if (!(await row.isVisible().catch(() => false))) {
        continue;
      }

      const cellTexts = await this.readCellTexts(row.locator('[role="gridcell"]'));
      rows.push(parseCampaignRow(headerIndexMap, cellTexts));
    }

    return rows;
  }

  /**
   * Google Ads virtualizes large campaign tables: only rows near the current
   * scroll position exist in the DOM. Reading once after the filter settles
   * therefore only captures a viewport's worth of rows, even when more match
   * the filter (totalFilteredRows). Scroll the last known row into view to make
   * the virtualized list render the next batch, merge by a stable key, and stop
   * once we've collected everything, stopped making progress, or timed out.
   */
  async readAllCampaignRows(page: Page, options: ReadAllCampaignRowsOptions): Promise<CampaignRow[]> {
    const deadline = Date.now() + options.overallTimeoutMs;

    let collected = await this.readCampaignRows(page);
    let noNewRowScrolls = 0;

    while (
      collected.length < options.totalFilteredRows &&
      noNewRowScrolls < MAX_NO_NEW_ROW_SCROLLS &&
      Date.now() < deadline
    ) {
      const scrolled = await this.scrollToLastRow(page);
      if (!scrolled) {
        break;
      }

      // Give the virtualized list a moment to mount newly-scrolled-in rows before
      // polling, then wait out any loading indicator those rows briefly show.
      await page.waitForTimeout(Math.min(300, options.perScrollWaitMs));
      await this.readinessWaiter.waitForLoadingToClear(page, options.perScrollWaitMs);

      const incoming = await this.readCampaignRows(page);
      const { merged, addedCount } = mergeCampaignRows(collected, incoming);
      collected = merged;

      noNewRowScrolls = addedCount > 0 ? 0 : noNewRowScrolls + 1;
    }

    return collected;
  }

  private async scrollToLastRow(page: Page): Promise<boolean> {
    const rowLocator = this.dataRowLocator(page);
    const rowCount = await rowLocator.count();
    if (rowCount === 0) {
      return false;
    }
    await rowLocator.nth(rowCount - 1).scrollIntoViewIfNeeded().catch(() => undefined);
    return true;
  }

  private dataRowLocator(page: Page) {
    // Header, group-toggle ("Drafts in progress"), and "Total:" summary rows also
    // match DATA_ROW_SELECTOR. Real campaign rows are distinguished by the inline
    // "settings" (gear) icon rendered next to the campaign name link, and never
    // say "Total:".
    return page.locator(DATA_ROW_SELECTOR).filter({ hasText: "settings" }).filter({ hasNotText: "Total:" });
  }

  private async readHeaderIndexMap(page: Page): Promise<Record<string, number>> {
    const headerLocator = page.locator('[role="columnheader"]');
    const headerTexts = await this.readCellTexts(headerLocator);
    return buildHeaderIndexMap(headerTexts);
  }

  private async readCellTexts(locator: ReturnType<Page["locator"]>): Promise<string[]> {
    const count = await locator.count();
    const texts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      texts.push(await locator.nth(index).innerText().catch(() => ""));
    }
    return texts;
  }
}
