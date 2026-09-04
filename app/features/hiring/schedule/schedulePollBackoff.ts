// The Schedule tab's live-status poll cadence (/perfect 2026-09-03, schedule-ui-2).
//
// The tab polled `/api/interview/by-entry` on a flat `setInterval(refresh, 6000)` with
// the failure swallowed by `.catch(() => undefined)`, and no visibility gate. Three
// consequences, all of them real:
//
//  * A recruiter who opened the tab and walked away kept a request every six seconds
//    running forever in a background tab — 600 requests an hour against a route that
//    reads SQLite, for a tab nobody was looking at.
//  * When the server was down, that became 600 FAILURES an hour, each one dropped on
//    the floor, while the tab kept confidently rendering an hour-old snapshot as if it
//    were live.
//  * There was no way back: nothing said the data was stale and nothing offered a retry.
//
// THE CURVE, stated: 6s while healthy. On consecutive failures it doubles —
// 12s, 24s, 48s — and CAPS at 60s, where it stays until a request succeeds; a success
// resets the count, so the next poll is 6s again. Capped deliberately: an unbounded
// exponential eventually stops retrying at all, and a recruiter who fixes their network
// must not have to reload the page to be picked up again.

/** Healthy cadence — a voice interview finishing is worth noticing within a few seconds. */
export const POLL_BASE_MS = 6_000;
/** The ceiling. A tab left open through an outage retries once a minute, forever. */
export const POLL_MAX_MS = 60_000;

/** Delay before the next poll, given the number of CONSECUTIVE failures so far
 *  (0 = the last request succeeded). Doubling, clamped to POLL_MAX_MS. A negative or
 *  non-finite count is treated as healthy — the caller's counter is a number from
 *  React state and a defensive floor is cheaper than a NaN interval. */
export function pollDelayMs(consecutiveFailures: number): number {
  const n = Number.isFinite(consecutiveFailures) ? Math.max(0, Math.floor(consecutiveFailures)) : 0;
  // Cap the exponent before the shift so a long outage can't overflow into Infinity.
  const factor = 2 ** Math.min(n, 10);
  return Math.min(POLL_BASE_MS * factor, POLL_MAX_MS);
}

/** Is the live view stale enough to SAY SO? One failure is a blip the next poll will
 *  paper over; from the second consecutive failure the tab is knowingly showing old
 *  data and must admit it rather than keep looking live. */
export function pollIsStale(consecutiveFailures: number): boolean {
  return consecutiveFailures >= 2;
}
