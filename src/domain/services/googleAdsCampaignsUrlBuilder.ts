import { customerIdToDigits } from "./customerIdParser.js";

/** Builds the Google Ads campaigns page URL for a given normalized customer id. */
export function buildGoogleAdsCampaignsUrl(normalizedCustomerId: string): string {
  const digits = customerIdToDigits(normalizedCustomerId);
  return `https://ads.google.com/aw/campaigns?ocid=${digits}&__c=${digits}`;
}
