/**
 * Returns true when `error` is a normal Telegram long-poll timeout —
 * either the local AbortSignal fired (DOMException TimeoutError / AbortError)
 * or the message string indicates a timeout. These should be treated as
 * "no updates received", not as real network failures.
 */
export function isFetchTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException) {
    // AbortSignal.timeout() throws DOMException { name: "TimeoutError", code: TIMEOUT_ERR }
    // AbortController.abort() throws DOMException { name: "AbortError" }
    return (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.code === DOMException.TIMEOUT_ERR
    );
  }

  if (error instanceof Error) {
    // Fallback: some runtimes surface the same conditions as plain Errors
    if (/^(TimeoutError|AbortError)$/.test(error.name)) return true;
    if (/The operation was aborted|operation timed out/i.test(error.message)) return true;
  }

  return false;
}
