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
// --- Invite link lifecycle: TTL / expiry (Direction 1) -------------------------
//
// A self-scheduling link used to be immortal: a pending invite that was never
// booked sat live forever, unlike a voice-interview link (INTERVIEW_LINK_TTL_DAYS,
// db/interviews.ts). Mirror that pattern here so a stale, never-booked link has an
// honest terminal fate ("expired") instead of accepting a booking weeks later.
//
// Expiry is DERIVED, not a stored status — like isInterviewLinkExpired — so it needs
// no migration and no write on existing rows: only a still-'pending' invite older
// than the TTL is expired. A confirmed booking is live; declined/no_show are already
// terminal. Kept here (pure, no DB) so the token route, the store, and the recruiter
// lifecycle panel share ONE derivation and can't drift.

/** How long a minted-but-never-booked self-scheduling link stays valid. Mirrors the
 *  voice-interview link TTL (INTERVIEW_LINK_TTL_DAYS = 7) so the two capability links
 *  age out on the same clock. */
export const INVITE_LINK_TTL_DAYS = 7;

const INVITE_LINK_TTL_MS = INVITE_LINK_TTL_DAYS * 86_400_000;

/** True when a self-scheduling invite is a dead capability: still 'pending' (never
 *  booked) and minted more than INVITE_LINK_TTL_DAYS ago. Derived — a confirmed
 *  booking never expires this way, and the explicit terminal states (declined /
 *  no_show) are already closed. `nowMs` is injectable for tests. */
export function isScheduleInviteExpired(invite: { status: string; createdAt: string }, nowMs: number = Date.now()): boolean {
  if (invite.status !== "pending") return false;
  const created = Date.parse(invite.createdAt);
  if (Number.isNaN(created)) return false;
  return created < nowMs - INVITE_LINK_TTL_MS;
}

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

// --- Candidate "propose your own times" escalation ------------------------------
//
// Two dead-ends used to strand a candidate: after MAX_RESCHEDULES they were told to
// "reply to your confirmation email", and when the whole horizon was booked the
// needs_more_slots flag sat on the invite with no flow behind it. The escalation lets
// a STUCK candidate name 1–MAX_PROPOSALS concrete times the recruiter can accept.
//
// This is still a candidate trust boundary (idea-e05aedfb's invariant): a proposed
// time is only persisted as a slot the SERVER would consider sane — future, within the
// horizon, a weekday, inside business hours in the interview zone, to the exact minute
// — and its label is SERVER-authored, never candidate text. It is DELIBERATELY wider
// than offeredSlotFor (any working hour, not just the two fixed offered times): the
// candidate reaches this path precisely because the offered grid is exhausted. The
// recruiter (trusted) then books an accepted proposal through the same collision-
// checked transactions confirmScheduleInvite/rescheduleScheduleInvite already enforce.

/** The business-hour window (interview zone) a candidate-PROPOSED time must fall in:
 *  [startHour, endHour). Wider than the fixed offered times but still fenced to sane
 *  weekday working hours so the trust boundary holds. */
export const PROPOSAL_HOURS = { startHour: 8, endHour: 18 } as const;

/** How many alternative times a stuck candidate may propose in one escalation. */
export const MAX_PROPOSALS = 3;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Validate a single candidate-PROPOSED time and mint its canonical, server-authored
 *  label — or null when it isn't a sane interview time: unparsable, past, beyond the
 *  horizon, on a weekend, or outside business hours, all reckoned in the INTERVIEW
 *  ZONE to the exact minute (stray seconds or a non-canonical offset are refused, like
 *  offeredSlotFor). Unlike offeredSlotFor it accepts ANY business-day working hour, not
 *  only the two fixed offered times. `nowMs` is injectable for tests. */
export function proposedSlotFor(slotAtIso: unknown, nowMs: number = Date.now(), tz: string = INTERVIEW_TZ): { value: string; label: string } | null {
  if (typeof slotAtIso !== "string" || slotAtIso.length === 0 || slotAtIso.length > 40) return null;
  const ms = Date.parse(slotAtIso);
  if (Number.isNaN(ms)) return null;
  if (ms <= nowMs || ms > nowMs + MAX_SLOT_AHEAD_MS) return null;
  const p = zonedParts(ms, tz);
  if (p.weekday === 0 || p.weekday === 6) return null; // weekend in the interview zone
  if (p.hour < PROPOSAL_HOURS.startHour || p.hour >= PROPOSAL_HOURS.endHour) return null; // outside business hours
  // Demand the EXACT canonical instant for that wall time in the zone (reject stray
  // seconds/ms or a non-offered UTC offset) — a slot's identity is the instant.
  if (ms !== zonedInstant(p.year, p.month, p.day, p.hour, p.minute, tz)) return null;
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return { value: new Date(ms).toISOString(), label: slotLabel(ms, time, tz) };
}

/** Validate a WHOLE candidate proposal batch (1–MAX_PROPOSALS times). Returns the
 *  server-authored, de-duplicated slots (input order preserved) or null when the batch
 *  is the wrong size or ANY instant fails proposedSlotFor — the route maps null to one
 *  honest "suggest 1–3 future weekday working-hour times" message. */
export function validateProposedSlots(raw: unknown, nowMs: number = Date.now(), tz: string = INTERVIEW_TZ): { value: string; label: string }[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PROPOSALS) return null;
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const v = proposedSlotFor(item, nowMs, tz);
    if (!v) return null;
    if (seen.has(v.value)) continue; // drop an exact duplicate instant
    seen.add(v.value);
    out.push(v);
  }
  return out.length > 0 ? out : null;
}

// --- One scheduling engine: grid ⇄ canonical instant (Direction 3) --------------
//
// The manual week grid (ScheduleCalendar) speaks in timezone-less wall-clock strings
// ("Tue 14:00"). These pure helpers bridge that abstraction to the invite engine's
// canonical ISO instants so a grid confirm produces the SAME collision-checked,
// reminder-eligible schedule_invites row a candidate self-booking does — one engine,
// not two stores. Reckoned in the interview zone (never the server clock).

const WD_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Resolve a recruiter grid pick ("Tue 14:00" — weekday + HH:MM in the interview
 *  zone) to the next FUTURE canonical instant matching that weekday and time, with a
 *  server-authored dated label. Unlike offeredSlotFor (the candidate trust boundary),
 *  this accepts ANY business-day hour — the recruiter is trusted and the grid offers a
 *  full working day. Returns null for a malformed pick or a weekend. Searches within
 *  the scheduling horizon so the resolved instant always sits inside the offer window. */
export function gridSlotToIso(gridSlot: string, nowMs: number = Date.now(), tz: string = INTERVIEW_TZ): { value: string; label: string } | null {
  const m = /^([A-Za-z]{3})\s+([01]\d|2[0-3]):([0-5]\d)$/.exec(gridSlot.trim());
  if (!m) return null;
  const wd = WD_INDEX[m[1]];
  if (wd === undefined || wd === 0 || wd === 6) return null; // unknown day or weekend
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  const time = `${m[2]}:${m[3]}`;
  const today = zonedParts(nowMs, tz);
  // Scan forward day-by-day; the first date whose interview-zone weekday matches AND
  // whose instant is still in the future is the booking. A weekday recurs within 7
  // days, so the loop always resolves for a valid weekday.
  for (let day = 0; day <= SLOT_HORIZON_DAYS; day += 1) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day));
    d.setUTCDate(d.getUTCDate() + day);
    if (d.getUTCDay() !== wd) continue;
    const ms = zonedInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm, tz);
    if (ms <= nowMs) continue; // matched today but the time already passed → next week
    return { value: new Date(ms).toISOString(), label: slotLabel(ms, time, tz) };
  }
  return null;
}

/** The absolute day+hour "bucket" of a canonical instant in the interview zone, e.g.
 *  "2026-07-15T14" — the identity the recruiter WEEK GRID actually speaks in (its rows
 *  are whole hours). Two bookings in the same interview-zone hour share a bucket even
 *  when their minutes differ (a 14:00 grid pick and an accepted 14:30 proposal), so the
 *  grid can treat the hour as occupied and the book handler can refuse to double-book it
 *  — the store's collision authority is the exact INSTANT, which wouldn't catch this.
 *  Absolute (dated), not weekday-based, so two different actual Wednesdays never
 *  false-collide. Returns null for an unparsable instant. */
export function hourBucketKey(iso: string | null | undefined, tz: string = INTERVIEW_TZ): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}`;
}

/** Place a canonical ISO instant back onto the week grid as its cell ("Tue 14:00"),
 *  in the interview zone — so invite bookings (recruiter- or candidate-made) render on
 *  the same grid. Off-hour bookings keep their true minutes ("Tue 14:30"); the grid
 *  buckets them into the hour cell for display (see ScheduleCalendar). Returns null for
 *  an unparsable instant or a weekend. */
export function isoToGridSlot(iso: string | null | undefined, tz: string = INTERVIEW_TZ): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(ms, tz);
  if (p.weekday === 0 || p.weekday === 6) return null;
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${DOW[p.weekday]} ${hh}:${mm}`;
}

// --- Dated grid: a CONCRETE week, not a weekday column (Direction "grid gets real dates") ---
//
// gridSlotToIso resolves a weekday-relative pick ("Tue 14:00") to the NEXT future
// Tuesday, so two different real Tuesdays collapse into one visual column and "book the
// 22nd specifically" is inexpressible. These helpers anchor the grid to a DATED slot —
// "YYYY-MM-DD HH:MM" in the interview zone — so a pick, a booked marker, and the
// collision instant all name one true calendar day. gridSlotToIso/isoToGridSlot stay for
// back-compat (the candidate flow + the route's legacy body.gridSlot branch + tests).

/** Resolve a dated grid pick (interview-zone calendar date + wall time) to its canonical
 *  ISO instant with a server-authored label — the DATED sibling of gridSlotToIso. The
 *  recruiter is trusted, so any business-day hour is accepted; a weekend, a past instant,
 *  or one beyond the scheduling horizon is refused (mirrors gridSlotToIso's future-only,
 *  in-horizon guarantee). `nowMs`/`tz` injectable for tests. */
export function dateSlotToIso(
  date: string,
  time: string,
  nowMs: number = Date.now(),
  tz: string = INTERVIEW_TZ
): { value: string; label: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date).trim());
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time).trim());
  if (!dm || !tm) return null;
  const y = +dm[1];
  const mo = +dm[2];
  const dd = +dm[3];
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  const hh = +tm[1];
  const mm = +tm[2];
  const ms = zonedInstant(y, mo, dd, hh, mm, tz);
  if (Number.isNaN(ms)) return null;
  if (ms <= nowMs || ms > nowMs + MAX_SLOT_AHEAD_MS) return null;
  const p = zonedParts(ms, tz);
  if (p.weekday === 0 || p.weekday === 6) return null; // weekend in the interview zone
  return { value: new Date(ms).toISOString(), label: slotLabel(ms, `${tm[1]}:${tm[2]}`, tz) };
}

/** Place a canonical instant onto the DATED grid as "YYYY-MM-DD HH:MM" in the interview
 *  zone — so a booking (recruiter- or candidate-made) seeds the exact calendar cell it
 *  occupies, in its true week. Off-hour bookings keep their true minutes; the grid buckets
 *  them into the hour row for display. Returns null for an unparsable instant or a weekend. */
export function isoToDateSlot(iso: string | null | undefined, tz: string = INTERVIEW_TZ): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(ms, tz);
  if (p.weekday === 0 || p.weekday === 6) return null;
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** One concrete weekday of the dated grid. `iso` is its interview-zone calendar date
 *  ("YYYY-MM-DD"); `past` marks a day before today (rendered disabled). */
export type GridDate = { iso: string; year: number; month: number; day: number; weekday: number; past: boolean };

/** The concrete weeks (each Mon–Fri) the manual grid pages through: from the week
 *  containing today to the week containing today + SLOT_HORIZON_DAYS, in the interview
 *  zone — so the pager spans exactly the offer horizon and every booking falls in a
 *  reachable week. Pure + zone-correct so the client grid and the server horizon agree.
 *  `nowMs`/`tz` injectable for tests. */
export function scheduleGridWeeks(nowMs: number = Date.now(), tz: string = INTERVIEW_TZ): GridDate[][] {
  const today = zonedParts(nowMs, tz);
  const todayNum = today.year * 10000 + today.month * 100 + today.day;
  // Monday of today's week (UTC Y/M/D arithmetic — a calendar date's weekday is zone-stable).
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const dow = base.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + mondayOffset);
  const horizonEnd = new Date(base);
  horizonEnd.setUTCDate(base.getUTCDate() + SLOT_HORIZON_DAYS);
  const weeks: GridDate[][] = [];
  const cursor = new Date(monday);
  while (cursor.getTime() <= horizonEnd.getTime()) {
    const week: GridDate[] = [];
    for (let i = 0; i < 5; i += 1) {
      // Mon..Fri
      const d = new Date(cursor);
      d.setUTCDate(cursor.getUTCDate() + i);
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + 1;
      const dd = d.getUTCDate();
      week.push({
        iso: `${y}-${pad2(mo)}-${pad2(dd)}`,
        year: y,
        month: mo,
        day: dd,
        weekday: d.getUTCDay(),
        past: y * 10000 + mo * 100 + dd < todayNum,
      });
    }
    weeks.push(week);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}
