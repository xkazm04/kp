// Slot proposal + validation for candidate self-scheduling — pure (no DB), so
// the trust-boundary decision is unit-testable (mirrors finalize-status.ts /
// preflight.ts). Extracted from schedule-store.ts when confirm-side validation
// landed (idea-e05aedfb), so proposal and validation share ONE derivation and
// can never drift.
//
// THE INVARIANT (idea-e05aedfb): a candidate-submitted booking is only ever
// persisted as a slot the server itself would have offered. The POST handler
// used to trust body.slot (display label) and body.slotAt (ISO) verbatim —
// letting a token holder book an out-of-hours/weekend/past time, and inject
// arbitrary text as the label, which is stored and rendered into confirmation
// and reminder EMAILS and the recruiter activity feed. Validation here is
// STRUCTURAL (future, ≤ window, business day, one of the offered times, exact
// minute) rather than membership in the current proposeSlots() page — stable
// across the midnight rollover of the proposal window — and the label is
// re-derived server-side from the validated time, never taken from the client.

/** The offered interview times per business day, in the interview zone. Defaults to
 *  10:00 + 14:00 but is config-driven via KP_INTERVIEW_TIMES (comma-separated "HH:MM")
 *  so a deployment can lift the per-day interview capacity beyond two — the simplest
 *  throughput lever short of a full per-interviewer availability model (the global,
 *  host-blind slot pool otherwise caps the WHOLE org at two interviews/day). Malformed
 *  entries are dropped; an empty/all-bad config falls back to the default. Deduped +
 *  sorted so the proposal order is stable and a slot's identity is one canonical instant.
 *  NOTE: collision is still global (host-blind) — per-interviewer/per-job availability
 *  and real-calendar conflict avoidance are the deferred Phase 2. */
export function parseInterviewTimes(raw: string | undefined): readonly string[] {
  const DEFAULT = ["10:00", "14:00"];
  if (!raw) return DEFAULT;
  const valid = [
    ...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))),
  ].sort();
  return valid.length > 0 ? valid : DEFAULT;
}

const TIMES = parseInterviewTimes(process.env.KP_INTERVIEW_TIMES);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The zone the offered interview HOURS (10:00/14:00, business days) are anchored to.
// slot_at stays an absolute instant, but a slot's wall-clock identity is defined in
// the INTERVIEWER's zone — NOT the server's. Previously proposeSlots/offeredSlotFor
// used Date#getHours/#setHours (server-local), while the candidate picker renders the
// instant in the CANDIDATE's browser zone — so a 10:00 slot minted on a Prague server
// showed as 04:00 in New York and a candidate's sensible local pick was rejected as
// "not an offered slot". Czech-market default; override per deployment with
// KP_INTERVIEW_TZ. (Showing both zones in the picker is a separate UI follow-up.)
export const INTERVIEW_TZ = process.env.KP_INTERVIEW_TZ || "Europe/Prague";

const _WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of an absolute instant AS SEEN in `tz` (never the server zone). */
function zonedParts(ms: number, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return {
    year: +m.year,
    month: +m.month,
    day: +m.day,
    hour: +m.hour % 24, // Intl can render midnight as "24"
    minute: +m.minute,
    second: +m.second,
    weekday: _WD[m.weekday] ?? 0,
  };
}

/** The absolute instant (ms) of a wall-clock time in `tz`. Standard offset
 *  correction: treat the wall time as if it were UTC, find the zone's offset at that
 *  guess, then subtract it. Accurate except inside the ~1h DST gap/overlap; the
 *  offered times (10:00/14:00) never sit in a transition, so one correction suffices. */
function zonedInstant(year: number, month1: number, day: number, hour: number, minute: number, tz: string): number {
  const asUTC = Date.UTC(year, month1 - 1, day, hour, minute, 0, 0);
  const p = zonedParts(asUTC, tz);
  const seenAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = seenAsUTC - asUTC; // how far ahead `tz` is from UTC at this instant
  return asUTC - offset;
}

/** How many days ahead the candidate self-scheduling picker offers slots — the
 *  ONE source of truth for the scheduling horizon. Widen this single constant to
 *  open more dates; proposeSlots' scan and offeredSlotFor's accept-window both
 *  derive from it, so they can't drift (they used to hardcode 21 and 22). When a
 *  fully-booked horizon yields zero slots, the route flags the invite for the
 *  recruiter rather than stranding the candidate (idea-5df8e10f). */
export const SLOT_HORIZON_DAYS = 21;

/** How far out a submitted slot still validates: the proposal horizon plus one
 *  day of slack, so a slot loaded just before midnight stays confirmable after
 *  the rollover. */
const MAX_SLOT_AHEAD_MS = (SLOT_HORIZON_DAYS + 1) * 86_400_000;

/** The one canonical human label for a slot — proposal and validation both mint it
 *  here from the slot's wall-clock IN THE INTERVIEW ZONE, so the stored label is
 *  always server-authored and zone-consistent. */
function slotLabel(ms: number, time: string, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${DOW[p.weekday]} ${p.day} ${MON[p.month - 1]} · ${time}`;
}

/** Propose the next few business-day interview slots, skipping ones already
 *  taken (by ISO `value`, the same identity bookedSlots() returns). `value` is
 *  the slot's ISO datetime (used for timed reminders + collision checks);
 *  `label` is the human-readable time shown to the candidate. Business days and the
 *  offered times are reckoned in `tz` (the interview zone), never the server clock. */
export function proposeSlots(taken: string[] = [], count = 6, tz: string = INTERVIEW_TZ): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const takenSet = new Set(taken);
  const today = zonedParts(Date.now(), tz); // the zone's CURRENT calendar date
  for (let day = 1; day <= SLOT_HORIZON_DAYS && out.length < count; day += 1) {
    // Advance the zone calendar date by `day` (UTC date arithmetic is safe for the
    // Y/M/D components — a calendar date's weekday is the same in any zone).
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day));
    d.setUTCDate(d.getUTCDate() + day);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip weekends (interview-zone calendar)
    for (const t of TIMES) {
      const [h, m] = t.split(":").map(Number);
      const value = new Date(zonedInstant(y, mo, dd, h, m, tz)).toISOString();
      if (takenSet.has(value)) continue;
      out.push({ value, label: slotLabel(Date.parse(value), t, tz) });
      if (out.length >= count) break;
    }
  }
  return out;
}

/** Validate a candidate-submitted slot time and mint its canonical label, or
 *  null when it isn't a slot the server would offer: unparsable, in the past,
 *  beyond the proposal window, on a weekend, or not exactly one of the offered
 *  times — all reckoned in the INTERVIEW ZONE (`tz`), to the exact instant.
 *  `nowMs` is injectable for tests. */
export function offeredSlotFor(slotAtIso: unknown, nowMs: number = Date.now(), tz: string = INTERVIEW_TZ): { value: string; label: string } | null {
  if (typeof slotAtIso !== "string" || slotAtIso.length === 0 || slotAtIso.length > 40) return null;
  const ms = Date.parse(slotAtIso);
  if (Number.isNaN(ms)) return null;
  if (ms <= nowMs || ms > nowMs + MAX_SLOT_AHEAD_MS) return null;
  const p = zonedParts(ms, tz);
  if (p.weekday === 0 || p.weekday === 6) return null; // weekend in the interview zone
  const time = TIMES.find((t) => {
    const [h, m] = t.split(":").map(Number);
    return p.hour === h && p.minute === m;
  });
  if (!time) return null;
  const [hh, mm] = time.split(":").map(Number);
  // Demand the EXACT canonical instant for that wall time in the zone, so a slot with
  // stray seconds/ms or a non-offered UTC offset (same hh:mm in a different zone) is
  // refused — the slot's identity is the instant, not just the displayed hour.
  if (ms !== zonedInstant(p.year, p.month, p.day, hh, mm, tz)) return null;
  return { value: new Date(ms).toISOString(), label: slotLabel(ms, time, tz) };
}
