export type SyncActionType = "APPEND" | "UPDATE" | "SKIP";

export interface ExistingSheetRow {
  campaignKey: string;
  rowIndex: number;
  values: string[];
}

export interface IncomingSheetRow {
  campaignKey: string;
  values: string[];
}

export interface SyncAction {
  type: SyncActionType;
  campaignKey: string;
  rowIndex?: number;
  values: string[];
}

const TRACKING_COLUMN_COUNT = 2;

function dataColumns(values: string[]): string[] {
  return values.slice(0, values.length - TRACKING_COLUMN_COUNT);
}

export function decideRowAction(existing: ExistingSheetRow | undefined, incoming: IncomingSheetRow): SyncAction {
  if (!existing) {
    return { type: "APPEND", campaignKey: incoming.campaignKey, values: incoming.values };
  }

  const existingData = dataColumns(existing.values);
  const incomingData = dataColumns(incoming.values);
  const unchanged = existingData.length === incomingData.length && existingData.every((value, index) => value === incomingData[index]);

  if (unchanged) {
    return { type: "SKIP", campaignKey: incoming.campaignKey, rowIndex: existing.rowIndex, values: existing.values };
  }

  return { type: "UPDATE", campaignKey: incoming.campaignKey, rowIndex: existing.rowIndex, values: incoming.values };
}

export function planSync(existingRows: ExistingSheetRow[], incomingRows: IncomingSheetRow[]): SyncAction[] {
  const existingByKey = new Map(existingRows.map((row) => [row.campaignKey, row]));
  return incomingRows.map((incoming) => decideRowAction(existingByKey.get(incoming.campaignKey), incoming));
}
