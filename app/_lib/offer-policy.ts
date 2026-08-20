// Offer expiry policy (idea-29361408). An extended offer used to live forever —
// the token never expired and status only flipped on accept/decline, so a
// recruiter had no deadline lever and a stale link stayed actionable
// indefinitely. A deadline is the recruiter's primary tool to force a candidate
// decision and free a headcount. Pure + injectable (no DB / no clock) so the rule
// is unit-testable, mirroring interview-reminder-policy.ts.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Bounds for a per-offer deadline (whole days). An "exploding" offer can be as
 *  tight as a day; an exec search may legitimately need months. */
export const OFFER_TTL_DAYS_MIN = 1;
export const OFFER_TTL_DAYS_MAX = 90;

/** The DEFAULT window an extended offer stays open before it lapses to `expired`,
 *  used when an offer carries no explicit deadline. Tunable per deployment via
 *  KP_OFFER_TTL_DAYS (validated to OFFER_TTL_DAYS_MIN..MAX); defaults to 7 days —
 *  the common recruiting default, short enough to keep momentum, long enough not to
 *  rush a considered candidate. Per-offer overrides flow through resolveOfferTtlMs. */
export function defaultOfferTtlDays(): number {
  const raw = Number(process.env.KP_OFFER_TTL_DAYS);
  return Number.isFinite(raw) && raw >= OFFER_TTL_DAYS_MIN && raw <= OFFER_TTL_DAYS_MAX ? Math.floor(raw) : 7;
}
export const OFFER_TTL_MS = defaultOfferTtlDays() * DAY_MS;

/** Resolve a per-offer TTL to the whole-day number actually applied — the validated
 *  request, or the deployment default when it is missing/out-of-range. This is the
 *  recruiter's primary lever (offers-onboarding #3): a tight, role-specific window is
 *  a known accept-rate accelerant for in-demand roles, while senior offers need weeks —
 *  one fixed 7-day window served neither. Exposed in DAYS (not just ms) because
 *  offers-store persists the applied figure and compares it across re-extends to tell a
 *  deliberate deadline change from a double-clicked, verbatim re-send. */
export function resolveOfferTtlDays(ttlDays?: number | null): number {
  const n = Number(ttlDays);
  if (Number.isFinite(n) && n >= OFFER_TTL_DAYS_MIN && n <= OFFER_TTL_DAYS_MAX) return Math.floor(n);
  return defaultOfferTtlDays();
}

/** The same resolution in milliseconds. Pure (no DB / no clock) so it stays testable. */
export function resolveOfferTtlMs(ttlDays?: number | null): number {
  return resolveOfferTtlDays(ttlDays) * DAY_MS;
}

/** Lead time before the deadline at which a single reminder nudge fires (T-48h by
 *  default). The proactive half of the expiry policy: the deadline lapses an offer
 *  silently; this is the one heads-up sent before that, so a candidate who simply
 *  forgot doesn't lose a live offer to silence. Tunable via KP_OFFER_REMINDER_LEAD_HOURS
 *  (1..168h); defaults to 48h. */
export function defaultOfferReminderLeadHours(): number {
  const raw = Number(process.env.KP_OFFER_REMINDER_LEAD_HOURS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 168 ? Math.floor(raw) : 48;
}
export const OFFER_REMINDER_LEAD_MS = defaultOfferReminderLeadHours() * HOUR_MS;

/** The expiry instant (ms) for an offer created at `createdAtMs`, `ttlDays` later
 *  (or the deployment default when no per-offer deadline is given). */
export function offerExpiresAtMs(createdAtMs: number, ttlDays?: number | null): number {
  return createdAtMs + resolveOfferTtlMs(ttlDays);
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
