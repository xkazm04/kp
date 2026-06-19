// Offer expiry policy (idea-29361408). An extended offer used to live forever —
// the token never expired and status only flipped on accept/decline, so a
// recruiter had no deadline lever and a stale link stayed actionable
// indefinitely. A deadline is the recruiter's primary tool to force a candidate
// decision and free a headcount. Pure + injectable (no DB / no clock) so the rule
// is unit-testable, mirroring interview-reminder-policy.ts.

/** How long an extended offer stays open before it lapses to `expired`. */
export const OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Lead time before the deadline at which a single reminder nudge fires (T-48h).
 *  The proactive half of the expiry policy: the deadline lapses an offer silently;
 *  this is the one heads-up sent before that, so a candidate who simply forgot
 *  doesn't lose a live offer to silence. */
export const OFFER_REMINDER_LEAD_MS = 48 * 60 * 60 * 1000; // 48 hours

/** The expiry instant (ms) for an offer created at `createdAtMs`. */
export function offerExpiresAtMs(createdAtMs: number): number {
  return createdAtMs + OFFER_TTL_MS;
}

/** Whether an open offer has passed its deadline. A missing/invalid expiry NEVER
 *  expires (fail-open): offers minted before the column existed must stay
 *  actionable rather than being silently killed by a null deadline. */
export function isOfferExpired(expiresAtIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAtIso) return false;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return false;
  return nowMs >= ms;
}

/** Whether a still-open offer has entered the reminder window: its deadline is in
 *  the FUTURE but within `leadMs`. A missing/invalid deadline never reminds — it never
 *  lapses, so there's nothing to nudge toward. Pure (no DB / no clock) like the rest of
 *  this module, so the heartbeat's reminder policy is unit-testable. */
export function isOfferReminderDue(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now(),
  leadMs: number = OFFER_REMINDER_LEAD_MS
): boolean {
  if (!expiresAtIso) return false;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return false;
  return ms > nowMs && ms <= nowMs + leadMs;
}

/** Whole-hours remaining until expiry (>= 0), or null when there's no valid
 *  deadline — for the candidate's countdown copy. Rounds UP so "0 hours left"
 *  only ever means actually expired (isOfferExpired true). */
export function offerHoursRemaining(expiresAtIso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!expiresAtIso) return null;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil((ms - nowMs) / (60 * 60 * 1000)));
}
