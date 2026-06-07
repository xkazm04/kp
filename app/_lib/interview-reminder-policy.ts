// Interview-reminder policy (idea-902261e7). The reminder sweep used to lean on a
// single 24h number for two unrelated jobs — the *look-ahead window* (how soon
// before a slot a reminder fires) and the *skip threshold* (how close to the slot
// a booking has to be before we suppress the reminder). Because both were 24h, a
// candidate who confirmed less than 24h out fell into the skip branch and received
// NO reminder at all — an undocumented gap that hit last-minute bookers hardest.
//
// THE DECISION (pure, testable, documented here so it stops being an accident of
// an inequality). A confirmed interview gets exactly one timed reminder, fired when
// its start falls within REMINDER_LEAD_MS. The only exception is a *short-notice*
// booking: when the candidate confirms so close to the slot that REMINDER_MIN_NOTICE_MS
// or less remains, the confirmation message they just received already doubles as
// their reminder — a separately-fired reminder would land moments behind it — so the
// timed reminder is suppressed and the confirmation is worded as a "see you soon"
// note (it does not promise a later reminder; see comms-dispatch.ts). Bookings made
// ABOVE the floor but inside the lead window (e.g. confirming 8h out) still get a
// (shortened-notice) reminder; only genuinely last-minute confirms are covered by the
// confirmation alone. The two durations are now distinct, named, and deliberately
// unequal so the coincidence can never silently reappear.

/** Reminder look-ahead window: the heartbeat fires a reminder when a confirmed
 *  interview's start is within this much time and none has been sent yet. */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // 24h

/** Short-notice floor: at or below this much time between confirming and the slot,
 *  the confirmation note IS the reminder, so no separate timed reminder is sent. */
export const REMINDER_MIN_NOTICE_MS = 2 * 60 * 60 * 1000; // 2h

/** A booking is "short notice" when this little time (or less) separates the
 *  confirmation from the slot — the confirmation serves as the only heads-up. */
export function isShortNoticeBooking(slotAtMs: number, bookedAtMs: number): boolean {
  return slotAtMs - bookedAtMs <= REMINDER_MIN_NOTICE_MS;
}

/** Whether a confirmed interview is due a timed reminder *now*: its start is in
 *  (now, now + leadMs] and it was not a short-notice booking the confirmation
 *  already covered. Pure (no DB / no clock) so the heartbeat's policy is unit-
 *  testable. `bookedAtMs === null` (unknown confirm time) does NOT suppress — a
 *  missing timestamp should never silently swallow a reminder. */
export function isReminderDue(opts: {
  nowMs: number;
  slotAtMs: number;
  bookedAtMs: number | null;
  leadMs?: number;
}): boolean {
  const { nowMs, slotAtMs, bookedAtMs, leadMs = REMINDER_LEAD_MS } = opts;
  if (Number.isNaN(slotAtMs)) return false;
  if (!(slotAtMs > nowMs && slotAtMs <= nowMs + leadMs)) return false;
  if (bookedAtMs === null || Number.isNaN(bookedAtMs)) return true;
  return !isShortNoticeBooking(slotAtMs, bookedAtMs);
}

// --- Bounded reminder dispatch: retry cap + backoff (idea-edab792a) ------------
//
// The heartbeat re-runs the reminder sweep every ~60s. The old loop reset a claim
// to NULL on ANY dispatch error, so a down comms provider turned into a tight
// re-claim/re-fail/re-release storm across every due invite — unbounded retries
// with no backoff hammering a failing dependency. These constants bound that: a
// reminder gets at most REMINDER_MAX_ATTEMPTS dispatch attempts, spaced by a
// growing backoff, after which the heartbeat gives up (and logs) instead of
// retrying forever. Kept here — pure, no DB, no clock — so the retry cadence is
// unit-testable exactly like the lead/short-notice policy above.

/** Hard cap on dispatch attempts for a single reminder. After this many failed
 *  sends the heartbeat stops retrying and logs, rather than re-hitting a failing
 *  comms provider on every tick until the slot passes. */
export const REMINDER_MAX_ATTEMPTS = 5;

/** Base gap before the first retry; doubles each subsequent attempt (capped). */
export const REMINDER_RETRY_BASE_MS = 60 * 1000; // 1 min

/** Upper bound on the per-retry gap, so the backoff never balloons past this. */
export const REMINDER_RETRY_MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 min

/** Minimum time that must elapse after `attemptsMade` failed dispatch attempts
 *  before the next attempt may be claimed: exponential backoff (base · 2^(n-1))
 *  capped at REMINDER_RETRY_MAX_BACKOFF_MS. So a down provider is retried a handful
 *  of times with widening gaps (1m, 2m, 4m, 8m…), not every 60s. Pure (no clock) so
 *  the cadence is unit-testable. `attemptsMade <= 0` means no attempt has run yet →
 *  no wait (the first send fires immediately). */
export function reminderRetryDelayMs(attemptsMade: number): number {
  if (attemptsMade <= 0) return 0;
  const exp = REMINDER_RETRY_BASE_MS * 2 ** (attemptsMade - 1);
  return Math.min(exp, REMINDER_RETRY_MAX_BACKOFF_MS);
}
