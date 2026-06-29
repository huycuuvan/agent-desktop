import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentScheduler } from "./AgentScheduler.js";
import { createRunGuard } from "../../domain/services/runGuard.js";
import type { TimerLike } from "./AgentScheduler.js";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createFakeTimer(): { timer: TimerLike; fireTick: () => void; intervalMs: number | undefined; isActive: () => boolean } {
  let callback: (() => void) | null = null;
  let intervalMs: number | undefined;

  const timer: TimerLike = {
    setInterval: (cb, ms) => {
      callback = cb;
      intervalMs = ms;
      return "fake-handle";
    },
    clearInterval: () => {
      callback = null;
    },
  };

  return {
    timer,
    fireTick: () => callback?.(),
    get intervalMs() {
      return intervalMs;
    },
    isActive: () => callback !== null,
  };
}

describe("AgentScheduler run-on-start behavior", () => {
  it("runs once immediately on start() when runOnStart is true, before any interval tick", async () => {
    const fake = createFakeTimer();
    let runCount = 0;
    const scheduler = new AgentScheduler(async () => { runCount += 1; }, { intervalMs: 60_000, runOnStart: true }, fake.timer);

    await scheduler.start();

    assert.equal(runCount, 1);
  });

  it("does not run immediately when runOnStart is false", async () => {
    const fake = createFakeTimer();
    let runCount = 0;
    const scheduler = new AgentScheduler(async () => { runCount += 1; }, { intervalMs: 60_000, runOnStart: false }, fake.timer);

    await scheduler.start();

    assert.equal(runCount, 0);
  });
});

describe("AgentScheduler interval scheduling", () => {
  it("registers the interval with the configured intervalMs and runs once per tick", async () => {
    const fake = createFakeTimer();
    let runCount = 0;
    const scheduler = new AgentScheduler(async () => { runCount += 1; }, { intervalMs: 300_000, runOnStart: false }, fake.timer);

    await scheduler.start();
    assert.equal(fake.intervalMs, 300_000);

    fake.fireTick();
    fake.fireTick();

    assert.equal(runCount, 2);
  });

  it("clears the interval on stop()", async () => {
    const fake = createFakeTimer();
    const scheduler = new AgentScheduler(async () => {}, { intervalMs: 60_000, runOnStart: false }, fake.timer);

    await scheduler.start();
    assert.equal(fake.isActive(), true);

    scheduler.stop();
    assert.equal(fake.isActive(), false);
  });
});

describe("AgentScheduler + runGuard: prevents overlapping runs", () => {
  it("skips a scheduled tick that fires while the previous run is still in-flight", async () => {
    const fake = createFakeTimer();
    let runCount = 0;
    let skipCount = 0;
    const deferred = createDeferred<void>();

    const guard = createRunGuard(async () => {
      runCount += 1;
      await deferred.promise;
    });

    const runOrSkip = async (): Promise<void> => {
      const result = await guard.runOrSkip();
      if (result === null) {
        skipCount += 1;
      }
    };

    const scheduler = new AgentScheduler(runOrSkip, { intervalMs: 60_000, runOnStart: false }, fake.timer);
    await scheduler.start();

    // First tick starts a long-running pipeline; it has not resolved yet.
    fake.fireTick();
    assert.equal(guard.isRunning(), true);

    // A second tick fires while the first run is still in-flight — it must be skipped, not run concurrently.
    fake.fireTick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(runCount, 1);
    assert.equal(skipCount, 1);

    deferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(guard.isRunning(), false);
  });
});
