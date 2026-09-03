// The attention-badge poll's SCHEDULE — pure, so node --test can pin it (the hook
// itself is React and the endpoint is a network read).
//
// The badges used to re-arm at a flat 60s regardless of whether the last read
// reached the server. Against a restarting server, a laptop off the network or a
// 500 loop that is one request a minute for ever, from every open tab, to refresh
// a HINT. The tasks dock already solved exactly this (app/_lib/task-poll-state.ts);
// the two polls disagreeing about how to treat a dead endpoint was the accident, so
// this reuses that curve's shape and its constants rather than inventing a second.

import { POLL_BACKOFF_BASE_MS, POLL_BACKOFF_MAX_MS } from "@/app/_lib/task-poll-state";

/** The healthy heartbeat. The automation loop mutates entries server-side with no
 *  client signal, so without a poll the badges lie within minutes on an idle-but-
 *  open studio. A minute is the slowest that still beats "lying". */
export const ATTENTION_POLL_MS = 60_000;

/** First delay after a failed read — one ordinary heartbeat, so a single dropped
 *  request costs nothing. Derived from the tasks curve's base (4s × 15). */
export const ATTENTION_BACKOFF_BASE_MS = POLL_BACKOFF_BASE_MS * 15;

/** The ceiling: ten minutes. Ten times the tasks dock's, because a badge count is
 *  worth an order of magnitude less than a running task's progress — and a reader
 *  who comes back to the tab gets an immediate read anyway (shouldPollNow). */
export const ATTENTION_BACKOFF_MAX_MS = POLL_BACKOFF_MAX_MS * 10;

/** How long to wait before the next read. Healthy: 60s. After N consecutive
 *  failures: 60s, 2m, 4m, 8m, then 10m for ever. One success resets `failures`
 *  and the schedule with it. Pure. */
export function attentionPollDelayMs(failures: number): number {
  if (failures <= 0) return ATTENTION_POLL_MS;
  // Clamped exponent: `2 ** 2000` is Infinity, and a NaN upstream would survive a
  // bare Math.min. Same guard as pollDelayMs.
  const backoff = ATTENTION_BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 10);
  return Math.min(ATTENTION_BACKOFF_MAX_MS, backoff);
}

/** Should the tick spend a request? A hidden document never polls — and coming
 *  BACK is the moment a stale badge is most visibly wrong, so the return is
 *  handled by the visibility listener as an immediate read, not by this. */
export function shouldPollNow(hidden: boolean): boolean {
  return !hidden;
}
