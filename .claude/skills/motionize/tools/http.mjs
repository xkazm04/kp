/**
 * The one HTTP door for the motionize tools.
 *
 * Every network call here talks to an image/vision provider, and none of them
 * carried a timeout: node's `fetch` waits forever, so a provider that accepted
 * the connection and then stalled hung the tool — and with it whatever agent run
 * was waiting on its stdout — with no output and no way to tell "slow" from
 * "dead". `AbortSignal.timeout` turns that into a named, catchable failure.
 *
 * The per-call budgets live at each call site (a base64 vision upload and a
 * one-line task poll do not deserve the same patience); this module only
 * guarantees that a budget EXISTS and that blowing it reads as a timeout rather
 * than a bare `AbortError`.
 */

/** Default when a call site has no opinion. Generous — these are image APIs. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export class HttpTimeoutError extends Error {
  constructor(url, ms) {
    super(`timed out after ${ms}ms: ${url}`);
    this.name = "HttpTimeoutError";
    this.url = url;
    this.timeoutMs = ms;
  }
}

/**
 * `fetch` with a mandatory abort budget. A caller's own `init.signal` is honored
 * too — whichever fires first wins — so this never takes away cancellation.
 */
export async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const budget = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, budget]) : budget;
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    // Only OUR budget becomes a timeout: a caller's abort stays the caller's.
    if (budget.aborted && !init.signal?.aborted) throw new HttpTimeoutError(String(url), timeoutMs);
    throw err;
  }
}
