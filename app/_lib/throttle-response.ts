import type { NextResponse } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";

// The ONE rule for telling a throttled caller WHEN to come back (challenge 2026-09-22
// shared-api-utilities/B, docs/architecture/api-contracts.md §1.4).
//
// A 429 is the limiter's main interface, and the callers that act on its wait are
// machines: Polar re-delivers a refused webhook, a lead relay retries, an agent re-sends
// its report. Without a figure each of them probes blind, and every probe is another
// refusal. The figure must come from the arithmetic that refused
// (`rateLimitRetryAfterMs`, `throttleRetryAfterMs`, or the engine's own wait), never a
// constant, and there must be NO header when there is no honest figure: a client that
// trusts a fabricated wait either hammers a door that wanted longer or sleeps through a
// window that was already open.
//
// Four routes used to hand-roll this, and two carried the same clamp verbatim; the
// contract test (app/api/rate-limit-contract.test.ts) now forbids a hand-set Retry-After
// anywhere under app/api.

/** Delta-seconds for a wait of `remainingMs`: rounded UP (never 0), capped at the
 *  window when one is given, `null` when the figure is not a finite positive number. */
export function retryAfterSeconds(remainingMs: number | null | undefined, windowMs?: number): number | null {
  if (typeof remainingMs !== "number" || !Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  if (typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0) {
    return Math.min(seconds, Math.max(1, Math.ceil(windowMs / 1000)));
  }
  return seconds;
}

/** Set `Retry-After` on `res` from the wait, or leave it off when there is no honest
 *  figure. `windowMs` caps the claim at the caller's own window; omit it for a wait an
 *  upstream ENGINE gave, which no window of ours bounds. Returns `res`. */
export function withRetryAfter<R extends Response>(res: R, remainingMs: number | null | undefined, windowMs?: number): R {
  const seconds = retryAfterSeconds(remainingMs, windowMs);
  if (seconds != null) res.headers.set("Retry-After", String(seconds));
  return res;
}

/** The coded throttle refusal that says when: `jsonRefusal("TOO_MANY_REQUESTS", 429)`
 *  plus `retryAfterSeconds` as data beside the code and the matching `Retry-After`
 *  header — both omitted when there is no honest figure. The code and message are the
 *  registry's, so a client that ignores the new field sees exactly the old answer. */
export function jsonThrottled(retryAfterMs: number | null | undefined, windowMs?: number): NextResponse {
  const seconds = retryAfterSeconds(retryAfterMs, windowMs);
  const res = jsonRefusal("TOO_MANY_REQUESTS", 429, seconds != null ? { retryAfterSeconds: seconds } : undefined);
  if (seconds != null) res.headers.set("Retry-After", String(seconds));
  return res;
}
