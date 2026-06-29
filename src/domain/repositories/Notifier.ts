export type NotificationStatus = "SENT" | "NO_CHANGES" | "NO_COMPARABLE_RUN" | "DRY_RUN";

export interface NotificationResult {
  status: NotificationStatus;
  message: string | null;
  changeCount: number;
}

export interface Notifier {
  notifyLatestDiff(dryRun: boolean): Promise<NotificationResult>;
}
