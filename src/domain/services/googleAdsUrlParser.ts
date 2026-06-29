import type { GoogleAdsQueryParams } from "../entities/GoogleAdsTab.js";

const GOOGLE_ADS_HOSTNAME = "ads.google.com";
const TITLE_SUFFIX = "Google Ads";
const QUERY_PARAM_KEYS = ["ocid", "uscid", "ascid", "__c", "__u"] as const;

export function isGoogleAdsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === GOOGLE_ADS_HOSTNAME;
  } catch {
    return false;
  }
}

export function parseGoogleAdsUrl(url: string): GoogleAdsQueryParams {
  const params: GoogleAdsQueryParams = {};

  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(url).searchParams;
  } catch {
    return params;
  }

  for (const key of QUERY_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) {
      params[key] = value;
    }
  }

  return params;
}

export function parseAccountNameFromTitle(title: string): string | undefined {
  const segments = title
    .split(" - ")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length > 0 && segments[segments.length - 1] === TITLE_SUFFIX) {
    segments.pop();
  }

  if (segments.length === 0) {
    return undefined;
  }

  if (segments.length > 1) {
    segments.shift();
  }

  const accountName = segments.join(" - ").trim();
  return accountName.length > 0 ? accountName : undefined;
}

export function resolveCustomerId(query: GoogleAdsQueryParams): string | undefined {
  return query.ocid ?? query.uscid ?? query.ascid ?? query.__c;
}
