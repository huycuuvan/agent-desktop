import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRunGuard } from "./runGuard.js";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createRunGuard", () => {
  it("skips a run that starts while a previous run is still in-flight", async () => {
    const deferred = createDeferred<string>();
    let runCount = 0;
    const guard = createRunGuard(async () => {
      runCount += 1;
      return deferred.promise;
    });

    const firstRunPromise = guard.runOrSkip();
    const secondResult = await guard.runOrSkip();

    assert.equal(secondResult, null);
    assert.equal(runCount, 1);

    deferred.resolve("done");
    const firstResult = await firstRunPromise;
    assert.equal(firstResult, "done");
  });

  it("allows a new run once the previous run has completed", async () => {
    let runCount = 0;
    const guard = createRunGuard(async () => {
      runCount += 1;
      return runCount;
    });

    const first = await guard.runOrSkip();
    const second = await guard.runOrSkip();

    assert.equal(first, 1);
    assert.equal(second, 2);
  });

  it("still allows a new run after a previous run threw", async () => {
    let attempt = 0;
    const guard = createRunGuard(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("boom");
      }
      return "ok";
    });

    await assert.rejects(() => guard.runOrSkip());
    const second = await guard.runOrSkip();
    assert.equal(second, "ok");
  });

  it("reports isRunning while a run is in-flight and false otherwise", async () => {
    const deferred = createDeferred<void>();
    const guard = createRunGuard(() => deferred.promise);

    assert.equal(guard.isRunning(), false);
    const runPromise = guard.runOrSkip();
    assert.equal(guard.isRunning(), true);

    deferred.resolve();
    await runPromise;
    assert.equal(guard.isRunning(), false);
  });
});
