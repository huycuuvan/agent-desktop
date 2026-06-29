export type PipelineStatus =
  | "SUCCESS"
  | "SUCCESS_WITH_NOTIFICATION_ERROR"
  | "COLLECTOR_FAILED"
  | "SNAPSHOT_FAILED"
  | "SHEETS_FAILED";

export interface PipelineRunSummary {
  collectorRunId: number | null;
  accounts: number;
  campaigns: number;
  failedAccounts: number;
  sheetsAppendedRows: number;
  sheetsUpdatedRows: number;
  sheetsSkippedRows: number;
  notificationStatus: string | null;
  notificationMessage: string | null;
  durationMs: number;
  status: PipelineStatus;
  error?: string;
  notificationError?: string;
}
