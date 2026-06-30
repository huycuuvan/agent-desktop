const DASHED_CUSTOMER_ID_RE = /\b(\d{3})-(\d{3})-(\d{4})\b/;
const PLAIN_CUSTOMER_ID_RE = /\b(\d{10})\b/;

/**
 * Finds a Google Ads customer id anywhere in free text (e.g. "@bot 5377061556",
 * "/accept_mcc 537-706-1556", or a raw invitation email body) and returns it
 * normalized to the canonical "537-706-1556" dashed format. Returns null if no
 * 10-digit customer id is present.
 */
export function normalizeCustomerId(raw: string): string | null {
  const dashedMatch = raw.match(DASHED_CUSTOMER_ID_RE);
  if (dashedMatch) {
    return `${dashedMatch[1]}-${dashedMatch[2]}-${dashedMatch[3]}`;
  }

  const plainMatch = raw.match(PLAIN_CUSTOMER_ID_RE);
  if (plainMatch) {
    const digits = plainMatch[1];
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  return null;
}

export function customerIdToDigits(normalizedCustomerId: string): string {
  return normalizedCustomerId.replace(/-/g, "");
}
