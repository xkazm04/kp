import { isOffline } from "../offline";
import { CALENDAR_TIMEOUT_MS } from "./constants";

// The ONE outbound door of the calendar integration: offline gating, the timeout, and the
// single throttle retry, in one place instead of five hand-rolled copies.
//
// WHY OFFLINE IS CHECKED HERE AND NOT LEFT TO THE GLOBAL GUARD. `installOfflineFetchGuard`
// (offline.ts) does block this egress in KP_OFFLINE mode — by REJECTING the fetch, which
// the calendar edge then reports as "Google request failed" and logs as an error. That is
// a lie about an air-gapped install: nothing failed, and there is nothing for the operator
// to fix. Every other module that spends network deliberately consults `isOffline` first
// and answers its own "no information" shape (billing/polar.ts, billing/mode.ts); the
// calendar was the one egress that did not. Checking first also means we never mint an
// access-token refresh, never burn the retry, and never wait a Retry-After for a request
// that was never going to leave the box.
//
// WHY EXACTLY ONE RETRY. Google answers 429 (rate limit / quota) and 503 (backend
// unavailable) for transient conditions it expects the caller to repeat, and this edge
// repeated nothing: one throttled response collapsed a whole availability check to
// "unavailable" — which the UI renders as "we could not check your calendar" — for a
// condition that clears in a second. One retry converts the common transient into an
// answer; more than one turns a public, per-request path (`/schedule/<token>`) into a
// place where a Google incident is amplified by kp, and stacks against the per-attempt
// timeout a candidate's page is waiting on. The wait is Google's own `Retry-After` when it
// names one, CAPPED — an honest "unavailable" beats a booking page that hangs because
// Google asked for 300 seconds.

/** Thrown INSTEAD of touching the network when KP_OFFLINE is on. Callers map it onto the
 *  same "no information" value they already return for an outage — never onto an error. */
export class CalendarOfflineError extends Error {
  constructor(url: string) {
    super(`KP_OFFLINE: the calendar edge did not call ${url}`);
    this.name = "CalendarOfflineError";
  }
}

/** The statuses Google means "ask again" by. 5xx in general is NOT retried: a 500 from
 *  Google is not documented as transient, and a bad request of ours would be repeated for
 *  nothing. */
export const RETRYABLE_STATUSES = [429, 503] as const;

/** The longest we will wait between the two attempts, however long Google asks for.
 *  A candidate's booking page is on the other end of this. */
export const MAX_RETRY_AFTER_MS = 2000;

/** Used when a throttled response names no delay at all. */
export const DEFAULT_RETRY_AFTER_MS = 250;

export function isRetryableStatus(status: number): boolean {
  return (RETRYABLE_STATUSES as readonly number[]).includes(status);
}

/**
 * How long to wait before the single retry, from Google's `Retry-After`.
 *
 * Both wire forms are read (delay-seconds and an HTTP-date), because Google uses both.
 * Anything absent, malformed, negative or in the past falls back to the default, and
 * EVERYTHING is clamped to `MAX_RETRY_AFTER_MS` — the header is a request, not an
 * instruction we owe a waiting candidate.
 */
export function retryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number {
  const raw = (header ?? "").trim();
  if (!raw) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(seconds * 1000)));
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowMs));
  return DEFAULT_RETRY_AFTER_MS;
}

export type CalendarFetchOptions = {
  /** Per-attempt bound. Defaults to the one CALENDAR_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Retry once on 429/503. Off by default — the OAuth token exchange is a one-shot code
   *  redemption and the disconnect revoke is best-effort, so neither wants a second try. */
  retry?: boolean;
  /** Seams for the tests: no real waiting, and no dependence on the shell's env. */
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call Google, bounded, offline-aware, and retried at most once on a throttle.
 *
 * Throws `CalendarOfflineError` in offline mode (before any network work) and whatever
 * fetch throws otherwise (including our own abort) — every caller in this directory
 * already turns a throw into its documented "no answer" value.
 */
export async function calendarFetch(
  url: string,
  init: RequestInit = {},
  opts: CalendarFetchOptions = {}
): Promise<Response> {
  if (isOffline(opts.env ?? process.env)) throw new CalendarOfflineError(url);
  const timeoutMs = opts.timeoutMs ?? CALENDAR_TIMEOUT_MS;
  const res = await attempt(url, init, timeoutMs);
  if (!opts.retry || !isRetryableStatus(res.status)) return res;

  const delay = retryAfterMs(res.headers.get("retry-after"), (opts.now ?? Date.now)());
  // Release the first response's body before abandoning it — an undrained stream keeps
  // undici's connection checked out, and this path runs on a per-request public route.
  try {
    await res.body?.cancel();
  } catch {
    /* the body was already consumed or errored — nothing to release */
  }
  console.warn(`[calendar] Google answered HTTP ${res.status}; retrying once in ${delay}ms`);
  await (opts.sleep ?? wait)(delay);
  // Exactly one retry: whatever this answers is the answer, throttle included.
  return attempt(url, init, timeoutMs);
}
