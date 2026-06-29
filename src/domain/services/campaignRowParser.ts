import type { CampaignRow } from "../entities/CampaignRow.js";

const HEADER_NOISE_PATTERN = /help_outline/g;
const EMPTY_CELL_VALUES = new Set(["", "—", "-"]);

export function buildHeaderIndexMap(headerTexts: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerTexts.forEach((raw, index) => {
    const normalized = normalizeHeaderText(raw);
    if (normalized.length > 0 && !(normalized in map)) {
      map[normalized] = index;
    }
  });
  return map;
}

export function parseCampaignRow(headerIndexMap: Record<string, number>, cellTexts: string[]): CampaignRow {
  const getCell = (headerName: string): string | undefined => {
    const headerIndex = headerIndexMap[headerName];
    if (headerIndex === undefined) {
      return undefined;
    }
    // Data rows render one extra leading cell (row-expand control) that column
    // headers don't have, so a header's cell is always one position to the right.
    return cellTexts[headerIndex + 1];
  };

  return {
    campaignName: cleanCampaignName(getCell("Campaign")),
    budget: cleanCellValue(getCell("Budget")),
    status: cleanCellValue(getCell("Status")),
    optimizationScore: cleanOptimizationScore(getCell("Optimization score")),
    account: cleanCellValue(getCell("Account")),
    campaignType: cleanCellValue(getCell("Campaign type")),
    impressions: cleanCellValue(getCell("Impr.")),
    interactions: cleanCellValue(getCell("Interactions")),
    interactionRate: cleanCellValue(getCell("Interaction rate")),
    avgCost: cleanCellValue(getCell("Avg. cost")),
    cost: cleanCellValue(getCell("Cost")),
    conversions: cleanCellValue(getCell("Conversions")),
  };
}

export function buildCampaignStableKey(row: CampaignRow): string {
  return [row.campaignName ?? "", row.account ?? "", row.budget ?? ""].map((part) => part.trim().toLowerCase()).join("||");
}

export function mergeCampaignRows(
  collected: CampaignRow[],
  incoming: CampaignRow[],
): { merged: CampaignRow[]; addedCount: number } {
  const merged = [...collected];
  const seenKeys = new Set(merged.map((row) => buildCampaignStableKey(row)));

  let addedCount = 0;
  for (const row of incoming) {
    const key = buildCampaignStableKey(row);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    merged.push(row);
    addedCount += 1;
  }

  return { merged, addedCount };
}

export function parsePaginationText(rawText: string | null | undefined): {
  paginationText: string | null;
  totalFilteredRows: number;
} {
  if (!rawText) {
    return { paginationText: null, totalFilteredRows: 0 };
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return { paginationText: null, totalFilteredRows: 0 };
  }

  const match = trimmed.match(/of\s+(\d+)/i);
  return {
    paginationText: trimmed,
    totalFilteredRows: match ? Number(match[1]) : 0,
  };
}

function normalizeHeaderText(raw: string): string {
  return raw.replace(HEADER_NOISE_PATTERN, "").replace(/\s+/g, " ").trim();
}

function cleanCellValue(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return EMPTY_CELL_VALUES.has(trimmed) ? null : trimmed;
}

function cleanCampaignName(raw: string | undefined): string | null {
  const cleaned = cleanCellValue(raw);
  if (!cleaned) {
    return null;
  }
  const withoutIcon = cleaned.replace(/\bsettings\b/gi, "").trim();
  return withoutIcon.length > 0 ? withoutIcon : null;
}

function cleanOptimizationScore(raw: string | undefined): string | null {
  const cleaned = cleanCellValue(raw);
  if (!cleaned) {
    return null;
  }
  const percentMatch = cleaned.match(/-?\d+(\.\d+)?%/);
  if (percentMatch) {
    return percentMatch[0];
  }
  const withoutIcon = cleaned.replace(/\badd_add\b/gi, "").trim();
  return withoutIcon.length > 0 ? withoutIcon : null;
}
