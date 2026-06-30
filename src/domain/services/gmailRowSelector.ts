export interface GmailRowInfo {
  index: number;
  visible: boolean;
  text: string;
}

export type GmailRowSelectionKind = "NO_MATCH" | "SINGLE_MATCH" | "MULTIPLE_MATCHES";

export interface GmailRowSelection {
  kind: GmailRowSelectionKind;
  /** Indices of visible rows that contain both the subject keyword and the customer id. */
  matchedIndices: number[];
  visibleCount: number;
  matchedCount: number;
  /** Text preview of the first matched row (for debug logging). */
  firstMatchPreview: string | null;
}

const SUBJECT_KEYWORD = "invitation to access a google ads account";

/**
 * Pure function — no I/O, fully unit-testable.
 *
 * Given a flat list of row data (visibility + text), returns which rows are
 * both visible and contain the invitation subject keyword AND the requested
 * customer id (either dashed "537-706-1556" or plain "5377061556").
 *
 * Safety contract:
 *  - A row is only a candidate if it is visible (not a hidden DOM node).
 *  - Both the subject keyword and the customer id must appear in the row text.
 *  - Callers must never click a row that is not in matchedIndices.
 */
export function selectVisibleMatchingRows(
  rows: GmailRowInfo[],
  normalizedCustomerId: string,
): GmailRowSelection {
  const digitsOnly = normalizedCustomerId.replace(/-/g, "");
  const visibleRows = rows.filter((r) => r.visible);

  const matched = visibleRows.filter((r) => {
    const lower = r.text.toLowerCase();
    const hasSubject = lower.includes(SUBJECT_KEYWORD);
    const hasId = lower.includes(normalizedCustomerId.toLowerCase()) || lower.includes(digitsOnly);
    return hasSubject && hasId;
  });

  const kind: GmailRowSelectionKind =
    matched.length === 0 ? "NO_MATCH" : matched.length === 1 ? "SINGLE_MATCH" : "MULTIPLE_MATCHES";

  return {
    kind,
    matchedIndices: matched.map((r) => r.index),
    visibleCount: visibleRows.length,
    matchedCount: matched.length,
    firstMatchPreview: matched[0] ? matched[0].text.slice(0, 120).trim() : null,
  };
}
