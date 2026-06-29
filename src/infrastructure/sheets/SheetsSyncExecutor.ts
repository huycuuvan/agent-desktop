import { SHEET_COLUMNS } from "../../domain/services/sheetRowMapper.js";
import { planSync, type ExistingSheetRow, type SyncAction } from "../../domain/services/SheetsSyncPlanner.js";
import type { SheetRowValues } from "../../domain/services/sheetRowMapper.js";
import type { SheetsClient } from "./SheetsClient.js";

export interface SheetsSyncSummary {
  appendedRows: number;
  updatedRows: number;
  skippedRows: number;
}

export interface SheetsSyncResult extends SheetsSyncSummary {
  actions: SyncAction[];
}

const CAMPAIGN_KEY_COLUMN_INDEX = SHEET_COLUMNS.indexOf("campaignKey");
const HEADER_ROW_COUNT = 1;

export class SheetsSyncExecutor {
  constructor(private readonly sheetsClient: SheetsClient) {}

  async sync(
    spreadsheetId: string,
    tabName: string,
    incomingRows: SheetRowValues[],
    dryRun: boolean,
  ): Promise<SheetsSyncResult> {
    const sheetData = await this.sheetsClient.readSheet(spreadsheetId, tabName);
    const existingRows = toExistingSheetRows(sheetData);

    const actions = planSync(existingRows, incomingRows);

    if (!dryRun) {
      await this.applyActions(spreadsheetId, tabName, sheetData, actions);
    }

    return { ...summarize(actions), actions };
  }

  private async applyActions(
    spreadsheetId: string,
    tabName: string,
    sheetData: string[][],
    actions: SyncAction[],
  ): Promise<void> {
    if (sheetData.length === 0) {
      await this.sheetsClient.writeHeader(spreadsheetId, tabName, [...SHEET_COLUMNS]);
    }

    const appendRows = actions.filter((action) => action.type === "APPEND").map((action) => action.values);
    await this.sheetsClient.appendRows(spreadsheetId, tabName, appendRows);

    const updates = actions.filter((action): action is SyncAction & { rowIndex: number } => action.type === "UPDATE" && action.rowIndex !== undefined);
    for (const update of updates) {
      await this.sheetsClient.updateRow(spreadsheetId, tabName, update.rowIndex, update.values);
    }
  }
}

function toExistingSheetRows(sheetData: string[][]): ExistingSheetRow[] {
  const dataRows = sheetData.slice(HEADER_ROW_COUNT);

  return dataRows
    .map((values, index) => ({
      campaignKey: values[CAMPAIGN_KEY_COLUMN_INDEX] ?? "",
      rowIndex: index + HEADER_ROW_COUNT + 1,
      values,
    }))
    .filter((row) => row.campaignKey !== "");
}

function summarize(actions: SyncAction[]): SheetsSyncSummary {
  return {
    appendedRows: actions.filter((action) => action.type === "APPEND").length,
    updatedRows: actions.filter((action) => action.type === "UPDATE").length,
    skippedRows: actions.filter((action) => action.type === "SKIP").length,
  };
}
