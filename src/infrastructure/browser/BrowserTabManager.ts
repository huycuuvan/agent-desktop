/**
 * BrowserTabManager
 *
 * Classifies, reuses, and cleans up browser tabs across all open browser
 * contexts. Works with a Playwright Browser instance connected over CDP.
 *
 * Rules:
 * - NEVER close: Gmail tab, Google Sheets tab, active Campaign tab being used.
 * - Reuse Campaign tab for the same account instead of opening a new one.
 * - Close Accept tabs after a successful accept.
 * - Close BLANK and CHROME_INTERNAL tabs during cleanup.
 * - When duplicates exist, keep the "best" tab: prefer /aw/campaigns + ocid in URL.
 */

import type { Browser, Page } from "playwright";
import { logger } from "../logger/logger.js";

export type TabType =
  | "GMAIL"
  | "GOOGLE_ADS_CAMPAIGNS"
  | "GOOGLE_ADS_ACCEPT"
  | "GOOGLE_SHEETS"
  | "BLANK"
  | "CHROME_INTERNAL"
  | "OTHER";

export interface ClassifiedTab {
  page: Page;
  type: TabType;
  url: string;
  title: string;
  /** For GOOGLE_ADS_CAMPAIGNS: the ocid / customerId digits, if parseable */
  customerId?: string;
}

// ── URL classifiers ──────────────────────────────────────────────────────────

export function classifyTabUrl(url: string, _title: string): TabType {
  if (!url || url === "about:blank" || url === "chrome://newtab/" || url === "") {
    return "BLANK";
  }
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return "CHROME_INTERNAL";
  }

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (host === "mail.google.com") return "GMAIL";

    if (host === "docs.google.com" && path.startsWith("/spreadsheets")) return "GOOGLE_SHEETS";
    if (host === "sheets.google.com") return "GOOGLE_SHEETS";

    if (host === "ads.google.com") {
      // Accept/invitation pages (check before campaigns — accept URLs can also have ocid)
      if (
        path.includes("invitation") ||
        path.includes("acceptinvite") ||
        path.includes("startacceptinvite") ||
        u.searchParams.has("ivid")
      ) {
        return "GOOGLE_ADS_ACCEPT";
      }
      // Campaigns or overview
      if (path.includes("/aw/campaigns") || path.includes("/aw/overview")) {
        return "GOOGLE_ADS_CAMPAIGNS";
      }
      return "OTHER";
    }
  } catch {
    // not a valid URL
  }

  return "OTHER";
}

/** Extract ocid / customerId digits from a Google Ads campaigns URL. */
export function extractCustomerIdFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const ocid = u.searchParams.get("ocid") ?? u.searchParams.get("__c") ?? u.searchParams.get("ascid");
    return ocid ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Score a campaign tab for duplicate resolution — higher is better.
 *   +2  URL path is /aw/campaigns  (most stable, collector-ready URL)
 *   +1  URL has ocid param         (allows dedup matching)
 *
 * Exported for unit testing.
 */
export function campaignTabScore(tab: Pick<ClassifiedTab, "url">): number {
  let score = 0;
  try {
    const u = new URL(tab.url);
    if (u.pathname.toLowerCase().includes("/aw/campaigns")) score += 2;
    if (u.searchParams.has("ocid")) score += 1;
  } catch {
    // invalid URL
  }
  return score;
}

/**
 * Given a list of campaign tabs that all share the same customerId, return
 * the one to KEEP. Tie-break: first tab in list wins (earliest opened).
 *
 * Exported for unit testing.
 */
export function selectBestCampaignTab(tabs: ClassifiedTab[]): ClassifiedTab | undefined {
  if (tabs.length === 0) return undefined;
  return tabs.reduce((best, tab) =>
    campaignTabScore(tab) > campaignTabScore(best) ? tab : best,
  );
}

// ── BrowserTabManager ────────────────────────────────────────────────────────

export class BrowserTabManager {
  constructor(private readonly browser: Browser) {}

  /** Return all pages with their classification. */
  async listTabs(): Promise<ClassifiedTab[]> {
    const result: ClassifiedTab[] = [];

    for (const context of this.browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        let title = "";
        try {
          title = await page.title();
        } catch {
          // page may have been closed; skip
          continue;
        }

        const type = classifyTabUrl(url, title);
        const customerId =
          type === "GOOGLE_ADS_CAMPAIGNS" ? extractCustomerIdFromUrl(url) : undefined;

        result.push({ page, type, url, title, customerId });
      }
    }

    return result;
  }

  /**
   * Find an existing Campaign tab for the given customerId (ocid digits).
   * Returns the page if found, null otherwise.
   */
  async findCampaignTab(customerIdDigits: string): Promise<Page | null> {
    const tabs = await this.listTabs();
    const candidates = tabs.filter(
      (t) => t.type === "GOOGLE_ADS_CAMPAIGNS" && t.customerId === customerIdDigits,
    );
    if (candidates.length === 0) return null;
    return selectBestCampaignTab(candidates)?.page ?? null;
  }

  /**
   * Find or create a Campaign tab for the given URL.
   * If an existing tab with the same customerId is found, reuse it.
   * Otherwise open a new tab.
   */
  async getOrCreateCampaignTab(
    url: string,
    customerIdDigits: string,
    waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit" = "domcontentloaded",
    timeoutMs = 60_000,
  ): Promise<Page> {
    if (customerIdDigits) {
      const existing = await this.findCampaignTab(customerIdDigits);
      if (existing) {
        logger.info({ customerIdDigits, url }, "BrowserTabManager: reusing existing campaign tab");
        try {
          await existing.bringToFront();
          if (existing.url() !== url) {
            await existing.goto(url, { waitUntil, timeout: timeoutMs });
          }
          return existing;
        } catch (err) {
          logger.warn(
            { customerIdDigits, err },
            "BrowserTabManager: failed to reuse campaign tab; opening new one",
          );
          // Fall through to create a new tab
        }
      }
    }

    const context = this.browser.contexts()[0];
    if (!context) throw new Error("BrowserTabManager: no browser context available");

    logger.info({ customerIdDigits, url }, "BrowserTabManager: opening new campaign tab");
    const page = await context.newPage();
    await page.goto(url, { waitUntil, timeout: timeoutMs });
    return page;
  }

  async bringToFront(page: Page): Promise<void> {
    await page.bringToFront();
  }

  /**
   * Close all GOOGLE_ADS_ACCEPT tabs.
   */
  async closeAcceptTabs(): Promise<number> {
    const tabs = await this.listTabs();
    let closed = 0;
    for (const tab of tabs) {
      if (tab.type !== "GOOGLE_ADS_ACCEPT") continue;
      try {
        logger.info({ url: tab.url }, "BrowserTabManager: closing accept tab");
        await tab.page.close();
        closed++;
      } catch (err) {
        logger.warn({ url: tab.url, err }, "BrowserTabManager: failed to close accept tab");
      }
    }
    return closed;
  }

  /**
   * Close duplicate Campaign tabs.
   *
   * For each customerId that has more than one Campaign tab, keeps the "best"
   * one (scored by `campaignTabScore`) and closes the rest.
   *
   * @param dryRun  When true, only logs — nothing is closed.
   * @param targetOcid  When provided, only deduplicates tabs for this ocid.
   * @returns URLs that were (or would be) closed.
   */
  async cleanupDuplicateCampaignTabs(dryRun = false, targetOcid?: string): Promise<string[]> {
    const tabs = await this.listTabs();

    // Group campaign tabs by customerId key
    const groups = new Map<string, ClassifiedTab[]>();
    for (const tab of tabs) {
      if (tab.type !== "GOOGLE_ADS_CAMPAIGNS") continue;
      const key = tab.customerId ?? tab.url; // fall back to URL when ocid unavailable
      if (targetOcid !== undefined && key !== targetOcid) continue;
      const group = groups.get(key) ?? [];
      group.push(tab);
      groups.set(key, group);
    }

    const closedUrls: string[] = [];
    for (const [key, group] of groups) {
      if (group.length <= 1) continue;

      const best = selectBestCampaignTab(group)!;
      const toClose = group.filter((t) => t !== best);

      logger.info(
        { key, keep: best.url, closeCount: toClose.length, dryRun },
        "BrowserTabManager: deduplicating campaign tabs",
      );

      for (const tab of toClose) {
        closedUrls.push(tab.url);
        if (!dryRun) {
          await tab.page.close().catch((err) =>
            logger.warn({ url: tab.url, err }, "BrowserTabManager: failed to close duplicate tab"),
          );
        }
      }
    }

    return closedUrls;
  }

  /**
   * Close BLANK and CHROME_INTERNAL tabs.
   */
  async cleanupBlankTabs(dryRun = false): Promise<string[]> {
    const tabs = await this.listTabs();
    const closedUrls: string[] = [];

    for (const tab of tabs) {
      if (tab.type !== "BLANK" && tab.type !== "CHROME_INTERNAL") continue;
      logger.info({ url: tab.url, dryRun }, "BrowserTabManager: cleanup blank/chrome tab");
      closedUrls.push(tab.url || "(blank)");
      if (!dryRun) {
        await tab.page.close().catch((err) =>
          logger.warn({ url: tab.url, err }, "BrowserTabManager: failed to close blank tab"),
        );
      }
    }

    return closedUrls;
  }

  /** Full cleanup: duplicates + blank/chrome tabs. */
  async cleanup(dryRun = false): Promise<{ duplicateCampaigns: string[]; blanks: string[] }> {
    const duplicateCampaigns = await this.cleanupDuplicateCampaignTabs(dryRun);
    const blanks = await this.cleanupBlankTabs(dryRun);
    return { duplicateCampaigns, blanks };
  }
}
