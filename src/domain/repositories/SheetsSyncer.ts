export interface SheetsSyncOutcome {
  appendedRows: number;
  updatedRows: number;
  skippedRows: number;
}

export interface SheetsSyncer {
  sync(dryRun: boolean): Promise<SheetsSyncOutcome>;
}
