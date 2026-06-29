import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRowAction, planSync } from "./SheetsSyncPlanner.js";
import type { ExistingSheetRow, IncomingSheetRow } from "./SheetsSyncPlanner.js";

const DATA_VALUES = ["QKA", "AUTO", "2026-06-28", "2026-06-29", "8361137753", "XOY SCAN", "key1", "Camp A", "727-700-2311", "$5,000.00/day", "Eligible", "Search", "0", "0", "", "", "$0.00", "0.00"];

function makeIncoming(campaignKey: string, dataValues: string[], runId = "2", lastSeenAt = "2026-06-30T00:00:00.000Z"): IncomingSheetRow {
  return { campaignKey, values: [...dataValues, runId, lastSeenAt] };
}

function makeExisting(campaignKey: string, rowIndex: number, dataValues: string[], runId = "1", lastSeenAt = "2026-06-29T00:00:00.000Z"): ExistingSheetRow {
  return { campaignKey, rowIndex, values: [...dataValues, runId, lastSeenAt] };
}

describe("decideRowAction (upsert decision logic)", () => {
  it("appends a row when no existing row matches the campaignKey", () => {
    const incoming = makeIncoming("key1", DATA_VALUES);
    const action = decideRowAction(undefined, incoming);

    assert.deepEqual(action, { type: "APPEND", campaignKey: "key1", values: incoming.values });
  });

  it("updates a row when the campaignKey exists but data columns changed", () => {
    const changedValues = [...DATA_VALUES];
    changedValues[10] = "Paused";
    const incoming = makeIncoming("key1", changedValues);
    const existing = makeExisting("key1", 5, DATA_VALUES);

    const action = decideRowAction(existing, incoming);

    assert.equal(action.type, "UPDATE");
    assert.equal(action.rowIndex, 5);
    assert.deepEqual(action.values, incoming.values);
  });

  it("skips a row when the campaignKey exists and data columns are unchanged, ignoring lastSeenRunId/lastSeenAt", () => {
    const incoming = makeIncoming("key1", DATA_VALUES, "2", "2026-06-30T00:00:00.000Z");
    const existing = makeExisting("key1", 5, DATA_VALUES, "1", "2026-06-29T00:00:00.000Z");

    const action = decideRowAction(existing, incoming);

    assert.equal(action.type, "SKIP");
    assert.equal(action.rowIndex, 5);
    assert.deepEqual(action.values, existing.values);
  });
});

describe("planSync", () => {
  it("returns one action per incoming row: append for new, update for changed, skip for unchanged", () => {
    const existingRows: ExistingSheetRow[] = [
      makeExisting("key1", 2, DATA_VALUES),
      makeExisting("key2", 3, DATA_VALUES),
    ];

    const changedValues = [...DATA_VALUES];
    changedValues[16] = "$99.00";

    const incomingRows: IncomingSheetRow[] = [
      makeIncoming("key1", DATA_VALUES),
      makeIncoming("key2", changedValues),
      makeIncoming("key3", DATA_VALUES),
    ];

    const actions = planSync(existingRows, incomingRows);

    assert.equal(actions.length, 3);
    assert.equal(actions[0]!.type, "SKIP");
    assert.equal(actions[1]!.type, "UPDATE");
    assert.equal(actions[1]!.rowIndex, 3);
    assert.equal(actions[2]!.type, "APPEND");
  });

  it("returns an empty action list for an empty incoming set", () => {
    assert.deepEqual(planSync([makeExisting("key1", 2, DATA_VALUES)], []), []);
  });
});
