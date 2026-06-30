import type { BrowserTab } from "../entities/BrowserTab.js";

export function isGmailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "mail.google.com";
  } catch {
    return false;
  }
}

/** Returns the index of the first open Gmail tab, or null if none is open. */
export function detectGmailTabIndex(tabs: BrowserTab[]): number | null {
  const index = tabs.findIndex((tab) => isGmailUrl(tab.url));
  return index === -1 ? null : index;
}
