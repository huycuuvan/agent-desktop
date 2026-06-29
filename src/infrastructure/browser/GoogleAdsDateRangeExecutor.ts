import type { Page } from "playwright";
import type { GoogleAdsDateMode } from "../../domain/entities/GoogleAdsDateMode.js";
import { parseGoogleAdsDateRangeLabel, resolveGoogleAdsDateMode } from "../../domain/services/googleAdsDateRangeResolver.js";

export interface DateRangeOutcome {
  applied: boolean;
  googleAdsDateLabel: string | null;
  fromDate: string | null;
  toDate: string | null;
  reason?: string;
}

const DATE_RANGE_NOT_APPLIED = "DATE_RANGE_NOT_APPLIED";
const LAST_2_DAYS_COUNT = "2";

export class GoogleAdsDateRangeExecutor {
  async applyDateRange(page: Page, mode: GoogleAdsDateMode): Promise<DateRangeOutcome> {
    const { effectiveMode, googleAdsDateLabel } = resolveGoogleAdsDateMode(mode);

    const failure: DateRangeOutcome = {
      applied: false,
      googleAdsDateLabel: null,
      fromDate: null,
      toDate: null,
      reason: DATE_RANGE_NOT_APPLIED,
    };

    try {
      const opened = await this.openDatePicker(page);
      if (!opened) {
        return failure;
      }

      const selected =
        effectiveMode === "LAST_2_DAYS" ? await this.selectDaysUpToToday(page, LAST_2_DAYS_COUNT) : await this.selectPreset(page, googleAdsDateLabel);
      if (!selected) {
        return failure;
      }

      await page.waitForTimeout(600);
      await this.dismissApplyButtonIfPresent(page);

      const { fromDate, toDate } = await this.readAppliedDateRange(page);
      if (!fromDate || !toDate) {
        return failure;
      }

      return { applied: true, googleAdsDateLabel, fromDate, toDate };
    } catch {
      return failure;
    }
  }

  private async openDatePicker(page: Page): Promise<boolean> {
    const picker = page.locator("material-date-range-picker").first();
    if ((await picker.count()) === 0) {
      return false;
    }
    await picker.click({ force: true }).catch(() => undefined);

    const panelOpenSignal = page.locator('material-select-item.days-to-today input').first();
    try {
      await panelOpenSignal.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async selectPreset(page: Page, presetLabel: string): Promise<boolean> {
    // The trigger's closed-state label can also contain this exact text (e.g. the
    // account is already on "Today" when we reopen it), so prefer the option
    // rendered inside the overlay panel, which is appended later in the DOM.
    const option = page.getByText(presetLabel, { exact: true }).last();
    if ((await option.count()) === 0 || !(await option.isVisible().catch(() => false))) {
      return false;
    }
    await option.click().catch(() => undefined);
    return true;
  }

  private async selectDaysUpToToday(page: Page, days: string): Promise<boolean> {
    const input = page.locator('material-select-item.days-to-today input').first();
    if ((await input.count()) === 0) {
      return false;
    }
    await input.fill(days);
    await page.keyboard.press("Enter").catch(() => undefined);
    return true;
  }

  private async dismissApplyButtonIfPresent(page: Page): Promise<void> {
    const applyButton = page.getByRole("button", { name: /^Apply$/i }).first();
    if ((await applyButton.count()) > 0 && (await applyButton.isVisible().catch(() => false))) {
      await applyButton.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  private async readAppliedDateRange(page: Page): Promise<{ fromDate: string | null; toDate: string | null }> {
    const dropdownButton = page.locator("dropdown-button.primary-range .button").first();
    const ariaLabel = (await dropdownButton.getAttribute("aria-label").catch(() => null)) ?? null;
    // The accessible label looks like "Jun 28 – 29, 2026 Not applicable"; strip the
    // trailing comparison-period text before parsing the date portion.
    const dateLabel = ariaLabel?.replace(/\s+not applicable.*$/i, "").trim() ?? null;
    return parseGoogleAdsDateRangeLabel(dateLabel);
  }
}
