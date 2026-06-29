export type PipelineStatus = "SUCCESS" | "COLLECTOR_FAILED" | "SNAPSHOT_FAILED" | "SHEETS_FAILED";

export interface PipelineRunSummary {
  collectorRunId: number | null;
  accounts: number;
  campaigns: number;
  failedAccounts: number;
  sheetsAppendedRows: number;
  sheetsUpdatedRows: number;
  sheetsSkippedRows: number;
  durationMs: number;
  status: PipelineStatus;
  error?: string;
}
