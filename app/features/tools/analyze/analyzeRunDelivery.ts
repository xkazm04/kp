// The DOM-free tail of an Analyze run: what counts as an intentional abort, how a
// caught failure becomes a localizable descriptor, and how a finished result is
// handed to the surface.
//
// It lives apart from analyzeRunAnalysis.ts for a concrete reason: that module
// takes a VALUE import from AnalysisProgress.tsx (STAGE_ORDER), and Node's
// type-stripping test runner cannot load a .tsx file — so nothing in it could be
// unit-tested. Everything here is plain TypeScript over plain values, so the abort
// contract is pinned by analyzeRunAnalysis.test.ts instead of living only in prose.

import { AnalyzeClientError } from "./AnalyzeApi";
import type { AnalyzeErrorCode, AnalyzeErrorInfo } from "./AnalyzeTypes";

// Turn a caught failure into the localizable descriptor the surface maps. Only an
// AnalyzeClientError carries a mappable code + optional server-English text; any
// other throw (a Zod parse blob, a bare network error, an unexpected reject) has
// no user-safe English, so it degrades to the caller's stable fallback code —
// never leaking an internal message into the toast.
export function toErrorInfo(caught: unknown, fallback: AnalyzeErrorCode): AnalyzeErrorInfo {
  if (caught instanceof AnalyzeClientError)
    return {
      code: caught.code,
      apiCode: caught.apiCode,
      serverText: caught.serverText,
      status: caught.status,
      retryAfterSeconds: caught.retryAfterSeconds,
    };
  return { code: fallback };
}

// An intentional abort (reset / cancel / tab unmount) is not a failure — the
// caller already tore the UI down, so it must not surface an error toast.
export function isAbort(signal: AbortSignal | undefined, caught: unknown): boolean {
  return Boolean(signal?.aborted) || (caught as { name?: string } | null)?.name === "AbortError";
}

/** The settle delay between "the stages all read done" and the result swap-in. */
export const RESULT_SETTLE_MS = 320;

/** The timer surface `scheduleResultDelivery` uses — injectable so the delivery
 *  contract can be tested without a browser clock. */
export type DeliveryTimers = {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
};

const windowTimers: DeliveryTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

/**
 * Hand the parsed result to the caller after the settle delay — but never after
 * an abort. The bare `window.setTimeout(...)` this replaces was neither cleared
 * nor signal-checked, so a run cancelled (reset / a fresh submit) or a tab
 * unmounted inside the 320 ms window still fired `onResult` and slammed a
 * superseded analysis into a torn-down surface. Three doors close that: an
 * already-aborted signal schedules nothing, the abort listener clears the timer,
 * and the callback re-checks the signal at fire time (the listener and the timer
 * can race in either order). Returns the cancel handle for a caller that wants to
 * drop the delivery itself.
 */
export function scheduleResultDelivery<T>(
  parsed: T,
  onResult: (value: T) => void,
  signal?: AbortSignal,
  timers: DeliveryTimers = windowTimers
): () => void {
  if (signal?.aborted) return () => {};
  const id = timers.set(() => {
    if (signal?.aborted) return;
    onResult(parsed);
  }, RESULT_SETTLE_MS);
  const cancel = () => timers.clear(id);
  signal?.addEventListener("abort", cancel, { once: true });
  return cancel;
}
