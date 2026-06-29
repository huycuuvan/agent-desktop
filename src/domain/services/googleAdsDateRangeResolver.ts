import type { GoogleAdsDateMode, GoogleAdsEffectiveDateMode } from "../entities/GoogleAdsDateMode.js";

export interface ResolvedDateMode {
  effectiveMode: GoogleAdsEffectiveDateMode;
  googleAdsDateLabel: string;
}

const EFFECTIVE_MODE_LABELS: Record<GoogleAdsEffectiveDateMode, string> = {
  TODAY: "Today",
  YESTERDAY: "Yesterday",
  LAST_2_DAYS: "Last 2 days",
};

/**
 * AUTO exists because the MCC/account timezone can differ from this machine's
 * clock — reading only "Today" can miss spend the account hasn't rolled into
 * yet. AUTO resolves to a 2-day window so a day boundary mismatch can't hide
 * data; it deliberately does not try to detect the account's timezone itself.
 */
export function resolveGoogleAdsDateMode(mode: GoogleAdsDateMode): ResolvedDateMode {
  const effectiveMode: GoogleAdsEffectiveDateMode = mode === "AUTO" ? "LAST_2_DAYS" : mode;
  return { effectiveMode, googleAdsDateLabel: EFFECTIVE_MODE_LABELS[effectiveMode] };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface ParsedGoogleAdsDateRange {
  fromDate: string | null;
  toDate: string | null;
}

/**
 * Parses the applied date-range control's accessible label, e.g.:
 *  - "Jun 29, 2026"            (single day)
 *  - "Jun 28 – 29, 2026"       (range within the same month)
 *  - "Jun 30 – Jul 1, 2026"    (range crossing a month boundary)
 * into ISO yyyy-mm-dd from/to dates. Returns nulls if the text doesn't match
 * any known shape rather than throwing, since this reads live third-party UI.
 */
export function parseGoogleAdsDateRangeLabel(rawText: string | null | undefined): ParsedGoogleAdsDateRange {
  if (!rawText) {
    return { fromDate: null, toDate: null };
  }

  const text = rawText.replace(/[–—]/g, "-").trim();

  const singleDayMatch = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (singleDayMatch) {
    const isoDate = toIsoDate(singleDayMatch[1], singleDayMatch[2], singleDayMatch[3]);
    return { fromDate: isoDate, toDate: isoDate };
  }

  const sameMonthRangeMatch = text.match(/^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/);
  if (sameMonthRangeMatch) {
    const [, month, fromDay, toDay, year] = sameMonthRangeMatch;
    return {
      fromDate: toIsoDate(month, fromDay, year),
      toDate: toIsoDate(month, toDay, year),
    };
  }

  const crossMonthRangeMatch = text.match(/^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (crossMonthRangeMatch) {
    const [, fromMonth, fromDay, toMonth, toDay, year] = crossMonthRangeMatch;
    return {
      fromDate: toIsoDate(fromMonth, fromDay, year),
      toDate: toIsoDate(toMonth, toDay, year),
    };
  }

  return { fromDate: null, toDate: null };
}

function toIsoDate(monthAbbrev: string, day: string, year: string): string | null {
  const monthIndex = MONTH_NAMES.findIndex((name) => name.toLowerCase() === monthAbbrev.toLowerCase());
  if (monthIndex === -1) {
    return null;
  }
  const monthNumber = String(monthIndex + 1).padStart(2, "0");
  const dayNumber = day.padStart(2, "0");
  return `${year}-${monthNumber}-${dayNumber}`;
}
