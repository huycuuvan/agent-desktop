import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SheetsSyncExecutor } from "./SheetsSyncExecutor.js";
import { SHEET_COLUMNS, buildSheetRows } from "../../domain/services/sheetRowMapper.js";
import type { SheetSyncCampaign } from "../../domain/entities/SheetSync.js";
import type { SheetsClient } from "./SheetsClient.js";

function makeCampaign(overrides: Partial<SheetSyncCampaign> = {}): SheetSyncCampaign {
  return {
    campaignKey: "key1",
    campaignName: "Camp A",
    account: "727-700-2311",
    customerId: "8361137753",
    accountName: "XOY SCAN",
    providerCode: "QKA",
    dateMode: "AUTO",
    fromDate: "2026-06-28",
    toDate: "2026-06-29",
    budget: "$5,000.00/day",
    status: "Eligible",
    campaignType: "Search",
    impressions: "0",
    interactions: "0",
    interactionRate: null,
    avgCost: null,
    cost: "$0.00",
    conversions: "0.00",
    ...overrides,
  };
}

class FakeSheetsClient implements Pick<SheetsClient, "readSheet" | "writeHeader" | "appendRows" | "updateRow"> {
  public sheetData: string[][];
  public headerWrites: string[][] = [];
  public appendCalls: string[][][] = [];
  public updateCalls: { rowIndex: number; values: string[] }[] = [];

  constructor(sheetData: string[][]) {
    this.sheetData = sheetData;
  }

  async readSheet(): Promise<string[][]> {
    return this.sheetData;
  }

  async writeHeader(_spreadsheetId: string, _tabName: string, header: string[]): Promise<void> {
    this.headerWrites.push(header);
  }

  async appendRows(_spreadsheetId: string, _tabName: string, rows: string[][]): Promise<void> {
    this.appendCalls.push(rows);
  }

  async updateRow(_spreadsheetId: string, _tabName: string, rowIndex: number, values: string[]): Promise<void> {
    this.updateCalls.push({ rowIndex, values });
  }
}

describe("SheetsSyncExecutor", () => {
  it("appends new campaigns and writes a header when the sheet is empty", async () => {
    const fakeClient = new FakeSheetsClient([]);
    const executor = new SheetsSyncExecutor(fakeClient as unknown as SheetsClient);
    const incomingRows = buildSheetRows([makeCampaign()], 1, "2026-06-30T00:00:00.000Z");

    const result = await executor.sync("sheet-id", "Campaigns", incomingRows, false);

    assert.equal(result.appendedRows, 1);
    assert.equal(result.updatedRows, 0);
    assert.equal(result.skippedRows, 0);
    assert.equal(fakeClient.headerWrites.length, 1);
    assert.deepEqual(fakeClient.headerWrites[0], [...SHEET_COLUMNS]);
    assert.equal(fakeClient.appendCalls.length, 1);
    assert.equal(fakeClient.appendCalls[0]!.length, 1);
  });

  it("updates an existing row in place when its data changed, addressed by sheet row index", async () => {
    const existingRow = buildSheetRows([makeCampaign({ status: "Eligible" })], 1, "2026-06-29T00:00:00.000Z")[0]!.values;
    const fakeClient = new FakeSheetsClient([[...SHEET_COLUMNS], existingRow]);
    const executor = new SheetsSyncExecutor(fakeClient as unknown as SheetsClient);
    const incomingRows = buildSheetRows([makeCampaign({ status: "Paused" })], 2, "2026-06-30T00:00:00.000Z");

    const result = await executor.sync("sheet-id", "Campaigns", incomingRows, false);

    assert.equal(result.appendedRows, 0);
    assert.equal(result.updatedRows, 1);
    assert.equal(result.skippedRows, 0);
    assert.equal(fakeClient.updateCalls.length, 1);
    assert.equal(fakeClient.updateCalls[0]!.rowIndex, 2);
    assert.equal(fakeClient.updateCalls[0]!.values[SHEET_COLUMNS.indexOf("status")], "Paused");
  });

  it("skips an unchanged row and writes nothing for it", async () => {
    const existingRow = buildSheetRows([makeCampaign()], 1, "2026-06-29T00:00:00.000Z")[0]!.values;
    const fakeClient = new FakeSheetsClient([[...SHEET_COLUMNS], existingRow]);
    const executor = new SheetsSyncExecutor(fakeClient as unknown as SheetsClient);
    const incomingRows = buildSheetRows([makeCampaign()], 2, "2026-06-30T00:00:00.000Z");

    const result = await executor.sync("sheet-id", "Campaigns", incomingRows, false);

    assert.equal(result.appendedRows, 0);
    assert.equal(result.updatedRows, 0);
    assert.equal(result.skippedRows, 1);
    assert.equal(fakeClient.updateCalls.length, 0);
    assert.equal(fakeClient.appendCalls.length, 1);
    assert.equal(fakeClient.appendCalls[0]!.length, 0);
  });

  it("does not write anything in dry-run mode but still reports the plan", async () => {
    const fakeClient = new FakeSheetsClient([]);
    const executor = new SheetsSyncExecutor(fakeClient as unknown as SheetsClient);
    const incomingRows = buildSheetRows([makeCampaign()], 1, "2026-06-30T00:00:00.000Z");

    const result = await executor.sync("sheet-id", "Campaigns", incomingRows, true);

    assert.equal(result.appendedRows, 1);
    assert.equal(fakeClient.headerWrites.length, 0);
    assert.equal(fakeClient.appendCalls.length, 0);
    assert.equal(fakeClient.updateCalls.length, 0);
  });
});
