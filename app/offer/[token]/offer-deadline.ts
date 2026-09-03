// The offer deadline label.
//
// THE BUG THIS CLOSES. The card formatted `expiresAt` with
// `Intl.DateTimeFormat(locale, { dateStyle, timeStyle })` and NO `timeZone`, so it
// rendered in whatever zone the candidate's browser happens to be in, with no zone
// indicator at all. An offer that lapses at 2026-09-12T21:30Z reads as "12 Sept,
// 23:30" in Prague, "12 Sept, 17:30" in New York and "13 Sept, 07:30" in Sydney —
// three different CALENDAR DAYS off one letter, on the one number that decides
// whether the candidate still has a job offer. The server-computed
// `hoursRemaining` beside it stayed right, so the two disagreed.
//
// THE GAP, STATED. The right zone is the OFFER's own — the hiring company's — and
// the `offers` table has no column for it (app/_lib/offers-store.ts: id, token,
// entry_id, candidate_label, job_id, job_title, currency, salary, payload_json,
// status, created_at, responded_at, expires_at, reminded_at, ttl_days,
// workspace_id). Nothing upstream captures a recruiter timezone either. So the
// label pins ONE explicit zone and NAMES it, which is unambiguous for every reader
// even when it is not their own: a candidate can convert a stated UTC time, and
// cannot convert an unstated one. When the offer row grows a zone, pass it in as
// `timeZone` and this module needs no other change.

/** A stored zone is only usable if the runtime recognizes it — Intl throws
 *  RangeError on an unknown one. Checked here rather than imported from
 *  app/_lib/timezone.ts so this module carries no `@/` alias: the unit runner
 *  cannot resolve one, and the whole reason this logic left the component was to
 *  be testable. */
function usableZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone every offer deadline is stated in until an offer carries its own. */
export const OFFER_DEADLINE_ZONE = "UTC";

/**
 * The deadline sentence's `{date}` argument: an absolute instant rendered in one
 * explicit, NAMED zone. Returns "" for a missing or unparsable instant so the
 * caller can omit the line rather than print "Invalid Date".
 */
export function formatOfferDeadline(iso: string | null | undefined, locale: string, timeZone?: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const zone = usableZone(timeZone) ? timeZone : OFFER_DEADLINE_ZONE;
  try {
    // Explicit components, NOT dateStyle/timeStyle: the spec forbids combining
    // those with timeZoneName (Intl throws a TypeError), and naming the zone is
    // the entire point of this label.
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
      // The whole point: the reader is told which clock this is.
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    // An ICU build that rejects the options combination must not take the card
    // down over a courtesy line — drop the label instead.
    return "";
  }
}
