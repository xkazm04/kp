// Offer expiry policy (idea-29361408). An extended offer used to live forever —
// the token never expired and status only flipped on accept/decline, so a
// recruiter had no deadline lever and a stale link stayed actionable
// indefinitely. A deadline is the recruiter's primary tool to force a candidate
// decision and free a headcount. Pure + injectable (no DB / no clock) so the rule
// is unit-testable, mirroring interview-reminder-policy.ts.

import { APP_CURRENCY } from "./format";

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
 *  (or the deployment default when no per-offer deadline is given).
 *
 *  A DEADLINE HERE IS ELAPSED TIME, NOT A WALL CLOCK — stated because it is
 *  observable and was previously undocumented. `ttlDays` is multiplied out to whole
 *  24-hour days, so a 7-day offer minted at 14:00 local across a spring-forward
 *  transition lapses at 15:00 local, not 14:00 (and an hour EARLIER on the wall clock
 *  across a fall-back). This is the deliberate choice, for two reasons: the offer row
 *  carries no timezone (kp has no per-workspace tz field — `expires_at` is a UTC ISO
 *  instant and every consumer, the lapse sweep and the reminder policy included,
 *  compares instants), and "you have seven days" is a promise about DURATION, which
 *  elapsed time keeps exactly and a wall-clock deadline would silently shorten or
 *  lengthen by an hour. The candidate is never left to infer the shift: the letter
 *  states an absolute deadline WITH its timezone (`formatOfferDeadline` in
 *  comms-dispatch.ts) and the accept page counts down in whole hours from the same
 *  server-side instant (`offerHoursRemaining`). Pinned by offer-policy.test.ts. */
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

// ---------------------------------------------------------------------------
// Offer TERMS validation (perfect: an-offer-carries-validated-terms, 2026-09-04)
//
// The terms an offer carries — the figure, the currency it is denominated in, any
// free-text note — reach a PUBLIC page (offer-finalize.offerView -> the candidate's
// accept card) and a SEALED decision record. Until this module owned them the only
// checks on that path were `Number(draft.recommended) || null` and
// `typeof draft.currency === "string"`: a negative figure rendered verbatim as the
// salary someone was asked to accept, and an arbitrary string ("about 120k", a
// pasted sentence) rode onto the accept page as a currency label. Pure + injectable
// like the rest of this module, so the rule is unit-testable without a DB.
// ---------------------------------------------------------------------------

/** The closed list of currencies an offer may be denominated in.
 *
 *  There was no repo-wide currency vocabulary to reuse when this was written:
 *  `format.APP_CURRENCY` is the app's SINGLE home denomination and
 *  `pipeline/jobfit/market_config.py` ships exactly two markets (CZK, EUR) — neither
 *  is a list an offer could be validated against. So this is the vocabulary, stated
 *  here and derived from APP_CURRENCY so a re-homed deployment cannot leave the home
 *  currency out of its own list: the shipped markets, plus the majors a European
 *  employer actually writes an offer in. A market added to `market_config.py` with a
 *  currency that is not here is a REFUSED offer, not a silently mislabelled one —
 *  add the code here in the same change. */
export const OFFER_CURRENCIES = [APP_CURRENCY, "EUR", "USD", "GBP", "PLN"] as const;
export type OfferCurrency = (typeof OFFER_CURRENCIES)[number];

/** Runtime guard for the closed list above (the house literal-array + derived-union
 *  + guard shape). Takes an ALREADY-normalized code — see `validateOfferTerms`. */
export function isOfferCurrency(code: string): code is OfferCurrency {
  return (OFFER_CURRENCIES as readonly string[]).includes(code);
}

/** Upper bound on an offer figure, in whole units of its currency. Deliberately
 *  loose — an annual senior package in CZK is comfortably eight digits, so this is
 *  not a business rule about what anyone should be paid; it is the line past which a
 *  figure is a typo, a units mix-up (minor units, a stray "000") or an injected value,
 *  and must not reach a candidate's accept page as the amount they are agreeing to. */
export const OFFER_SALARY_MAX = 100_000_000;

/** Cap on the optional free-text terms note carried on the draft. Enough for a real
 *  paragraph about a bonus or a notice period; short enough that an unbounded string
 *  cannot ride into the sealed decision record and the letter. */
export const OFFER_NOTES_MAX_CHARS = 2_000;

/** The refusal vocabulary for invalid terms. These are REFUSAL codes (a decision the
 *  recruiter can act on), mirrored in `REFUSAL_ERRORS` and the four catalogs. */
export type OfferTermsRefusalCode = "OFFER_SALARY_INVALID" | "OFFER_CURRENCY_UNSUPPORTED" | "OFFER_NOTES_TOO_LONG";

export type OfferTerms = { salary: number | null; currency: OfferCurrency | null; notes: string | null };
export type OfferTermsResult =
  | ({ ok: true } & OfferTerms)
  | { ok: false; code: OfferTermsRefusalCode; max: number };

/** Validate (and normalize) the terms an offer will be minted with.
 *
 *  UNPRICED IS LEGAL, INVALID IS NOT — the distinction this function exists to draw.
 *  A missing figure or currency stays null: `draft_offer` deliberately refuses to
 *  invent a number when the band is unknown (automation.py), the auto-extend gate
 *  parks an unpriced draft for a human, and the accept card renders a null figure
 *  unit-less rather than mislabelling it (P2-1). A value that is PRESENT but outside
 *  what an offer can mean is a different thing, and it refuses.
 *
 *  - salary: a value that does not parse to a finite number is treated as unpriced
 *    (null) — the behaviour every existing draft already relies on. A value that DOES
 *    parse must be > 0 and <= OFFER_SALARY_MAX, and is floored to a whole unit.
 *  - currency: normalized case/whitespace-insensitively (`" czk "` -> `"CZK"`, the
 *    same normalization salary-band.ts applies before comparing two figures) and then
 *    required to be in OFFER_CURRENCIES. A non-string, non-empty value refuses rather
 *    than silently becoming null: it means the draft carried SOMETHING as a currency.
 *  - notes: trimmed; an empty note is null; over the cap refuses.
 */
export function validateOfferTerms(input: { salary?: unknown; currency?: unknown; notes?: unknown }): OfferTermsResult {
  const rawSalary = input.salary;
  let salary: number | null = null;
  if (rawSalary !== null && rawSalary !== undefined && rawSalary !== "") {
    const n = Number(rawSalary);
    if (Number.isFinite(n)) {
      // 0 is "no figure" (`Number(x) || null` has always collapsed it); anything
      // below it is a figure nobody can be offered.
      if (n < 0 || n > OFFER_SALARY_MAX) return { ok: false, code: "OFFER_SALARY_INVALID", max: OFFER_SALARY_MAX };
      salary = n > 0 ? Math.floor(n) : null;
    }
    // Unparseable (a sentence, an object) stays unpriced — see the contract above.
  }

  const rawCurrency = input.currency;
  let currency: OfferCurrency | null = null;
  if (rawCurrency !== null && rawCurrency !== undefined && rawCurrency !== "") {
    if (typeof rawCurrency !== "string") {
      return { ok: false, code: "OFFER_CURRENCY_UNSUPPORTED", max: OFFER_CURRENCIES.length };
    }
    const code = rawCurrency.trim().toUpperCase();
    if (code !== "") {
      if (!isOfferCurrency(code)) return { ok: false, code: "OFFER_CURRENCY_UNSUPPORTED", max: OFFER_CURRENCIES.length };
      currency = code;
    }
  }

  const rawNotes = input.notes;
  let notes: string | null = null;
  if (typeof rawNotes === "string") {
    const trimmed = rawNotes.trim();
    if (trimmed.length > OFFER_NOTES_MAX_CHARS) {
      return { ok: false, code: "OFFER_NOTES_TOO_LONG", max: OFFER_NOTES_MAX_CHARS };
    }
    notes = trimmed === "" ? null : trimmed;
  }

  return { ok: true, salary, currency, notes };
}
