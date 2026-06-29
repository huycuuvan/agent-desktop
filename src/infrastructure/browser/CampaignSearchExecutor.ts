import type { Page } from "playwright";

export interface CampaignSearchOutcome {
  searchApplied: boolean;
  filterChipFound: boolean;
  reason?: string;
}

const SEARCH_INPUT_NOT_FOUND = "SEARCH_INPUT_NOT_FOUND";
const CAMPAIGN_NAME_FILTER_LABEL = "Campaign name";

export class CampaignSearchExecutor {
  async applyFilter(page: Page, keyword: string): Promise<CampaignSearchOutcome> {
    const opened = await this.openCampaignNameFilterEditor(page);
    if (!opened) {
      return { searchApplied: false, filterChipFound: false, reason: SEARCH_INPUT_NOT_FOUND };
    }

    const valueBox = page.locator('textarea[aria-label="Value"]').first();
    if ((await valueBox.count()) === 0 || !(await valueBox.isVisible().catch(() => false))) {
      return { searchApplied: false, filterChipFound: false, reason: SEARCH_INPUT_NOT_FOUND };
    }

    await valueBox.fill(keyword);

    const applyButton = page.getByRole("button", { name: /^Apply$/i }).first();
    if ((await applyButton.count()) === 0) {
      return { searchApplied: false, filterChipFound: false, reason: SEARCH_INPUT_NOT_FOUND };
    }
    await applyButton.click();

    await this.waitForSettle(page);

    const filterChipFound = await this.isFilterChipPresent(page, keyword);
    return { searchApplied: true, filterChipFound };
  }

  /**
   * Google Ads renders the campaign-name filter value as a textarea reachable two
   * different ways depending on whether a filter chip already exists:
   *  - chip exists: click the "Campaign name contains ..." chip to open its editor.
   *  - no chip yet: click "Add filter", type "Campaign name" into the field picker
   *    search box, then click the "Campaign name" menu item.
   */
  private async openCampaignNameFilterEditor(page: Page): Promise<boolean> {
    const valueBox = page.locator('textarea[aria-label="Value"]').first();

    if (await this.clickExistingCampaignNameChip(page, valueBox)) {
      return true;
    }

    // The filter bar can be collapsed behind a "Show N active filters" button.
    // (Not to be confused with the unrelated "View (N filters)" saved-view selector.)
    const filterBarToggle = page.getByRole("button", { name: /Show \d+ active filters?/i }).first();
    if ((await filterBarToggle.count()) > 0 && (await filterBarToggle.isVisible().catch(() => false))) {
      await filterBarToggle.click().catch(() => undefined);
      await page.waitForTimeout(300);
      if (await this.clickExistingCampaignNameChip(page, valueBox)) {
        return true;
      }
    }

    const addFilterTrigger = page.getByText(/^Add filter$/i).first();
    if ((await addFilterTrigger.count()) === 0 || !(await addFilterTrigger.isVisible().catch(() => false))) {
      return false;
    }
    await addFilterTrigger.click().catch(() => undefined);

    const fieldPickerSearch = page.locator('input[aria-label="Add filter"][placeholder="Search"]').first();
    if (!(await this.waitForVisible(fieldPickerSearch))) {
      return false;
    }
    await fieldPickerSearch.fill(CAMPAIGN_NAME_FILTER_LABEL);

    const campaignNameOption = page.getByText(new RegExp(`^${CAMPAIGN_NAME_FILTER_LABEL}$`, "i")).first();
    if (!(await this.waitForVisible(campaignNameOption))) {
      return false;
    }
    await campaignNameOption.click().catch(() => undefined);

    return this.waitForVisible(valueBox);
  }

  private async clickExistingCampaignNameChip(page: Page, valueBox: ReturnType<Page["locator"]>): Promise<boolean> {
    const existingChip = page.getByText(/campaign name contains/i).first();
    if ((await existingChip.count()) === 0 || !(await existingChip.isVisible().catch(() => false))) {
      return false;
    }
    await existingChip.click().catch(() => undefined);
    return this.waitForVisible(valueBox);
  }

  private async waitForVisible(locator: ReturnType<Page["locator"]>, timeoutMs = 5000): Promise<boolean> {
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  private async isFilterChipPresent(page: Page, keyword: string): Promise<boolean> {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chipLocator = page.getByText(new RegExp(`contains\\s+${escapedKeyword}`, "i"));
    return (await chipLocator.count()) > 0;
  }

  private async waitForSettle(page: Page): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
