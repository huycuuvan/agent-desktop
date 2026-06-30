import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFetchTimeoutError } from "./telegramErrors.js";

describe("isFetchTimeoutError — DOMException cases", () => {
  it("returns true for DOMException with name TimeoutError (AbortSignal.timeout() behavior)", () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns true for DOMException with name AbortError (AbortController.abort() behavior)", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns true for DOMException with code TIMEOUT_ERR (23)", () => {
    const err = new DOMException("Timeout", "TimeoutError");
    // DOMException.TIMEOUT_ERR === 23
    assert.equal(err.code, DOMException.TIMEOUT_ERR);
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns false for DOMException with a different name/code (real network error)", () => {
    const err = new DOMException("Network error", "NetworkError");
    assert.equal(isFetchTimeoutError(err), false);
  });
});

describe("isFetchTimeoutError — plain Error fallback cases", () => {
  it("returns true for Error with name TimeoutError", () => {
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns true for Error with name AbortError", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns true for Error with 'The operation was aborted' message", () => {
    const err = new Error("The operation was aborted due to timeout");
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns true for Error with 'operation timed out' message", () => {
    const err = new Error("fetch operation timed out");
    assert.equal(isFetchTimeoutError(err), true);
  });

  it("returns false for a generic Error (real API error)", () => {
    const err = new Error("Telegram getUpdates failed: 429 Too Many Requests");
    assert.equal(isFetchTimeoutError(err), false);
  });

  it("returns false for a generic Error with network text", () => {
    const err = new Error("ECONNREFUSED 127.0.0.1:443");
    assert.equal(isFetchTimeoutError(err), false);
  });
});

describe("isFetchTimeoutError — non-Error values", () => {
  it("returns false for a plain string", () => {
    assert.equal(isFetchTimeoutError("timeout"), false);
  });

  it("returns false for null", () => {
    assert.equal(isFetchTimeoutError(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isFetchTimeoutError(undefined), false);
  });

  it("returns false for a number", () => {
    assert.equal(isFetchTimeoutError(408), false);
  });
});
