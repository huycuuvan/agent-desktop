export interface AgentSchedulerOptions {
  intervalMs: number;
  runOnStart: boolean;
}

export interface TimerLike {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const defaultTimer: TimerLike = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/**
 * Drives a run function on a fixed interval, optionally firing once
 * immediately on start(). Accepts an injectable timer so the scheduling
 * logic (run-on-start, interval registration, stop/clear) is testable
 * without waiting on real wall-clock time.
 */
export class AgentScheduler {
  private intervalHandle: unknown = null;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly options: AgentSchedulerOptions,
    private readonly timer: TimerLike = defaultTimer,
  ) {}

  async start(): Promise<void> {
    if (this.options.runOnStart) {
      await this.run();
    }

    this.intervalHandle = this.timer.setInterval(() => {
      void this.run();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      this.timer.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
