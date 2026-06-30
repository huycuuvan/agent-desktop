import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import type { GmailInvitationSearcher, GmailSearchOutcome } from "../../domain/repositories/GmailInvitationSearcher.js";
import type { GmailInvitationCandidate } from "../../domain/entities/GmailInvitation.js";
import type { AdsPowerProfileRepository } from "../../domain/repositories/AdsPowerProfileRepository.js";
import { detectGmailTabIndex } from "../../domain/services/gmailTabDetector.js";
import { selectVisibleMatchingRows, type GmailRowInfo } from "../../domain/services/gmailRowSelector.js";
import { resolveCandidateMatch } from "../../domain/services/gmailCandidateBuilder.js";
import { logger } from "../logger/logger.js";

interface GmailSession {
  browser: Browser;
  page: Page;
}

const SIGN_IN_SELECTORS = ['[data-identifier]', 'input[type="email"]', '[aria-label*="Sign in"]'];
const GMAIL_SEARCH_INPUT = 'input[aria-label="Search mail"], input[name="q"]';
const INVITATION_SUBJECT = "Accept your invitation to access a Google Ads account";
const RESULT_ROW_SELECTOR = '[role="row"][jscontroller], tr.zA';

// Selectors for the open-email detail view, tried in order.
const EMAIL_BODY_SELECTORS = ['.a3s.aiL', '.ii.gt .a3s', '.ii.gt div[dir="ltr"]', 'div[dir="ltr"]'];
const EMAIL_SUBJECT_SELECTORS = ['h2[data-legacy-thread-id]', '[data-thread-perm-id] h2', '.hP'];

export class GmailWebSearchExecutor implements GmailInvitationSearcher {
  constructor(
    private readonly profileRepository: AdsPowerProfileRepository,
    private readonly searchTimeoutMs: number,
    private readonly screenshotDir: string,
    private readonly preferredProfileId?: string,
  ) {}

  async search(normalizedCustomerId: string): Promise<GmailSearchOutcome> {
    const profiles = await this.profileRepository.listOpenProfiles();

    const ordered = this.preferredProfileId
      ? [...profiles].sort((a) => (a.profileId === this.preferredProfileId ? -1 : 1))
      : profiles;

    for (const profile of ordered) {
      let browser: Browser | undefined;
      try {
        browser = await chromium.connectOverCDP(profile.wsEndpoint);
        const pages = browser.contexts().flatMap((ctx) => ctx.pages());
        const gmailIndex = detectGmailTabIndex(pages.map((p) => ({ title: p.url(), url: p.url() })));

        if (gmailIndex === null) {
          await browser.close().catch(() => undefined);
          continue;
        }

        const page = pages[gmailIndex];
        await page.bringToFront();

        if (await this.isSignInPage(page)) {
          await browser.close().catch(() => undefined);
          return { kind: "SIGN_IN_REQUIRED" };
        }

        const searchResult = await this.searchForInvitations(page, normalizedCustomerId);

        if (searchResult.kind !== "FOUND") {
          await browser.close().catch(() => undefined);
          return searchResult;
        }

        const session: GmailSession = { browser, page };
        return { kind: "FOUND", candidates: searchResult.candidates, profile, session };
      } catch (error) {
        logger.warn({ profileId: profile.profileId, err: error }, "GmailWebSearchExecutor: error scanning profile");
        await browser?.close().catch(() => undefined);
      }
    }

    return { kind: "TAB_NOT_FOUND" };
  }

  private async isSignInPage(page: Page): Promise<boolean> {
    for (const selector of SIGN_IN_SELECTORS) {
      if ((await page.locator(selector).count().catch(() => 0)) > 0) return true;
    }
    return false;
  }

  private async searchForInvitations(
    page: Page,
    normalizedCustomerId: string,
  ): Promise<
    | { kind: "FOUND"; candidates: GmailInvitationCandidate[] }
    | { kind: "ROW_NO_MATCH" }
    | { kind: "ROW_MULTIPLE_MATCHES"; count: number }
  > {
    const digitsOnly = normalizedCustomerId.replace(/-/g, "");
    const query = `subject:"${INVITATION_SUBJECT}" (${normalizedCustomerId} OR ${digitsOnly})`;

    const searchInput = page.locator(GMAIL_SEARCH_INPUT).first();
    if (!(await searchInput.isVisible().catch(() => false))) {
      logger.warn("GmailWebSearchExecutor: search input not visible");
      return { kind: "ROW_NO_MATCH" };
    }

    await searchInput.click();
    await searchInput.fill(query);
    await searchInput.press("Enter");

    await page.waitForLoadState("networkidle", { timeout: this.searchTimeoutMs }).catch(() => undefined);
    await page.waitForTimeout(2000);

    return this.collectFromVisibleMatchingRows(page, normalizedCustomerId);
  }

  private async collectFromVisibleMatchingRows(
    page: Page,
    normalizedCustomerId: string,
  ): Promise<
    | { kind: "FOUND"; candidates: GmailInvitationCandidate[] }
    | { kind: "ROW_NO_MATCH" }
    | { kind: "ROW_MULTIPLE_MATCHES"; count: number }
  > {
    const rowLocator = page.locator(RESULT_ROW_SELECTOR);
    const totalCount = await rowLocator.count().catch(() => 0);

    const rowInfos: GmailRowInfo[] = await Promise.all(
      Array.from({ length: totalCount }, async (_, i): Promise<GmailRowInfo> => {
        const row = rowLocator.nth(i);
        const [visible, text] = await Promise.all([
          row.isVisible().catch(() => false),
          row.textContent().catch(() => ""),
        ]);
        return { index: i, visible, text: text ?? "" };
      }),
    );

    const selection = selectVisibleMatchingRows(rowInfos, normalizedCustomerId);

    logger.info(
      {
        totalDomRows: totalCount,
        visibleRowsCount: selection.visibleCount,
        matchedRowsCount: selection.matchedCount,
        matchedRowTextPreview: selection.firstMatchPreview,
        customerId: normalizedCustomerId,
      },
      "GmailWebSearchExecutor: row selection result",
    );

    if (selection.kind === "NO_MATCH") {
      return { kind: "ROW_NO_MATCH" };
    }

    if (selection.kind === "MULTIPLE_MATCHES") {
      logger.warn(
        { matchedRowsCount: selection.matchedCount, customerId: normalizedCustomerId },
        "GmailWebSearchExecutor: multiple visible matching rows — refusing to open any",
      );
      return { kind: "ROW_MULTIPLE_MATCHES", count: selection.matchedCount };
    }

    // Exactly one visible matching row.
    const rowIndex = selection.matchedIndices[0]!;
    const rowPreviewText = selection.firstMatchPreview ?? "";
    const candidate = await this.openRowAndExtract(page, rowLocator, rowIndex, normalizedCustomerId, rowPreviewText);

    // If we opened the row but candidate resolution returned null, that means
    // neither the body nor the row preview confirmed the customer id.
    return { kind: "FOUND", candidates: candidate ? [candidate] : [] };
  }

  private async openRowAndExtract(
    page: Page,
    rowLocator: Locator,
    rowIndex: number,
    normalizedCustomerId: string,
    rowPreviewText: string,
  ): Promise<GmailInvitationCandidate | null> {
    const row = rowLocator.nth(rowIndex);

    try {
      await row.scrollIntoViewIfNeeded({ timeout: 5000 });
      await row.click({ timeout: 8000 }).catch(async (err) => {
        logger.warn({ err }, "GmailWebSearchExecutor: normal click failed, retrying with force");
        await row.click({ force: true, timeout: 8000 });
      });

      // Wait for the email detail view: first the URL/state to settle, then
      // specifically wait for the body element to become visible — networkidle
      // alone fires before Gmail's SPA has injected the email content.
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await this.waitForEmailBodyVisible(page);

      return await this.extractCandidateFromOpenEmail(page, normalizedCustomerId, rowPreviewText);
    } catch (error) {
      logger.warn({ rowIndex, err: error }, "GmailWebSearchExecutor: error opening email row");
      return null;
    } finally {
      await page.goBack().catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
    }
  }

  /** Waits for one of the known Gmail email-body selectors to become visible. */
  private async waitForEmailBodyVisible(page: Page): Promise<void> {
    const selector = EMAIL_BODY_SELECTORS.join(", ");
    await page
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {
        logger.debug("GmailWebSearchExecutor: email body element did not become visible within 10s");
      });
    // Small extra settle to let Gmail finish rendering the full content.
    await page.waitForTimeout(800);
  }

  private async extractCandidateFromOpenEmail(
    page: Page,
    normalizedCustomerId: string,
    rowPreviewText: string,
  ): Promise<GmailInvitationCandidate | null> {
    // Subject
    let subject: string | null = null;
    for (const sel of EMAIL_SUBJECT_SELECTORS) {
      const el = page.locator(sel).first();
      if ((await el.count().catch(() => 0)) > 0) {
        subject = await el.textContent().catch(() => null);
        if (subject) break;
      }
    }

    // Body
    let bodyText: string | null = null;
    for (const sel of EMAIL_BODY_SELECTORS) {
      const el = page.locator(sel).first();
      if ((await el.count().catch(() => 0)) > 0) {
        bodyText = await el.textContent().catch(() => null);
        if (bodyText?.trim()) break;
      }
    }

    // Message id
    const messageIdEl = page.locator("[data-message-id]").first();
    const messageId = (await messageIdEl.getAttribute("data-message-id").catch(() => null)) ?? `msg_${Date.now()}`;

    // Accept URL
    const acceptBtn = page.getByRole("link", { name: /ACCEPT INVITATION/i }).first();
    const acceptUrl = (await acceptBtn.getAttribute("href").catch(() => null)) ?? null;

    const result = resolveCandidateMatch({
      messageId,
      subject,
      bodyText,
      rowPreviewText,
      normalizedCustomerId,
      acceptUrl,
    });

    logger.info(
      {
        messageId,
        emailBodyTextPreview: bodyText?.slice(0, 120).trim() ?? null,
        bodyContainsCustomerId: result.bodyContainsCustomerId,
        rowContainsCustomerId: result.rowContainsCustomerId,
        acceptUrlFound: result.acceptUrlFound,
        fallbackUsed: result.fallbackUsed,
        candidateReason: result.candidate?.candidateReason ?? null,
        customerId: normalizedCustomerId,
      },
      "GmailWebSearchExecutor: candidate extraction result",
    );

    return result.candidate;
  }

  async captureScreenshot(page: Page, label: string): Promise<string> {
    await mkdir(this.screenshotDir, { recursive: true });
    const safe = label.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const file = `gmail_intake_${safe}_${Date.now()}.png`;
    const filePath = path.join(this.screenshotDir, file);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }
}
