import type { Page } from "playwright";

export class RefreshExecutor {
  async refresh(page: Page): Promise<boolean> {
    try {
      const refreshIcon = page.getByText(/^refresh$/i).first();
      if ((await refreshIcon.count()) === 0) {
        return false;
      }

      const refreshButton = refreshIcon.locator('xpath=ancestor::*[@role="button"][1]').first();
      if ((await refreshButton.count()) === 0 || !(await refreshButton.isVisible().catch(() => false))) {
        return false;
      }

      await refreshButton.click();
      return true;
    } catch {
      return false;
    }
  }
}
