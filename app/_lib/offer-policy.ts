// Offer expiry policy (idea-29361408). An extended offer used to live forever —
// the token never expired and status only flipped on accept/decline, so a
// recruiter had no deadline lever and a stale link stayed actionable
// indefinitely. A deadline is the recruiter's primary tool to force a candidate
// decision and free a headcount. Pure + injectable (no DB / no clock) so the rule
// is unit-testable, mirroring interview-reminder-policy.ts.

/** How long an extended offer stays open before it lapses to `expired`. */
export const OFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

/** Whole-hours remaining until expiry (>= 0), or null when there's no valid
 *  deadline — for the candidate's countdown copy. Rounds UP so "0 hours left"
 *  only ever means actually expired (isOfferExpired true). */
export function offerHoursRemaining(expiresAtIso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!expiresAtIso) return null;
  const ms = Date.parse(expiresAtIso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil((ms - nowMs) / (60 * 60 * 1000)));
}
