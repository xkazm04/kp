// Locks the slot trust boundary for candidate self-scheduling (idea-e05aedfb):
// POST /api/schedule/[token] used to persist body.slot/body.slotAt verbatim, so
// a token holder could book an out-of-hours/weekend/past time and inject
// arbitrary label text into confirmation/reminder emails and the recruiter
// activity feed. offeredSlotFor is the gate: only a slot the server itself
// would offer validates, and the label is re-derived server-side.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { offeredSlotFor, parseInterviewTimes, proposeSlots, SLOT_HORIZON_DAYS, isScheduleInviteExpired, INVITE_LINK_TTL_DAYS, gridSlotToIso, isoToGridSlot, hourBucketKey, proposedSlotFor, validateProposedSlots, MAX_PROPOSALS, dateSlotToIso, isoToDateSlot, scheduleGridWeeks } from "./schedule-slots.ts";

test("parseInterviewTimes is config-driven, validated, deduped, and falls back safely", () => {
  assert.deepEqual(parseInterviewTimes(undefined), ["10:00", "14:00"]);
  assert.deepEqual(parseInterviewTimes(""), ["10:00", "14:00"]);
  assert.deepEqual(parseInterviewTimes("09:00,13:30,17:00"), ["09:00", "13:30", "17:00"]);
  assert.deepEqual(parseInterviewTimes("10:00, 10:00 ,14:00"), ["10:00", "14:00"]); // trim + dedup + sort
  assert.deepEqual(parseInterviewTimes("25:99,nope,"), ["10:00", "14:00"]); // all invalid → default
});

// Fixed reference in UTC so the offered-zone math is deterministic regardless of the
// test runner's own TZ. Monday 2026-06-08 12:00 UTC; offered zone pinned to UTC.
const NOW = Date.UTC(2026, 5, 8, 12, 0, 0, 0);
const TZ = "UTC";
const utc = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 5, d, h, m, 0, 0)).toISOString();

test("a slot the server would offer validates and gets the canonical server-minted label", () => {
  const tue10 = offeredSlotFor(utc(9, 10), NOW, TZ); // Tue 9 Jun · 10:00
  assert.ok(tue10, "expected Tuesday 10:00 to validate");
  assert.equal(tue10!.label, "Tue 9 Jun · 10:00");
  assert.equal(tue10!.value, utc(9, 10));
  assert.ok(offeredSlotFor(utc(10, 14), NOW, TZ), "expected Wednesday 14:00 to validate");
});

test("past, weekend, out-of-window, and off-grid times are refused", () => {
  assert.equal(offeredSlotFor(utc(8, 10), NOW, TZ), null, "this morning (past) must be refused");
  assert.equal(offeredSlotFor(utc(13, 10), NOW, TZ), null, "Saturday must be refused");
  assert.equal(offeredSlotFor(utc(14, 10), NOW, TZ), null, "Sunday must be refused");
  assert.equal(offeredSlotFor(new Date(Date.UTC(2026, 6, 14, 10, 0, 0, 0)).toISOString(), NOW, TZ), null, "beyond the proposal window must be refused");
  assert.equal(offeredSlotFor(utc(9, 10, 30), NOW, TZ), null, "10:30 is not an offered time");
  assert.equal(offeredSlotFor(utc(9, 9), NOW, TZ), null, "09:00 is not an offered time");
});

test("offered hours are anchored to the interview zone, not the server/UTC clock", () => {
  // 10:00 in Europe/Prague in June (CEST = UTC+2) is 08:00 UTC. The SAME absolute
  // instant must validate as an offered slot when the interview zone is Prague, with
  // a Prague-wall-clock label — regardless of where the candidate or server sits.
  const tenPrague = new Date(Date.UTC(2026, 5, 9, 8, 0, 0, 0)).toISOString(); // 08:00Z = 10:00 Prague
  const v = offeredSlotFor(tenPrague, NOW, "Europe/Prague");
  assert.ok(v, "10:00 Prague (08:00Z) should validate as an offered slot");
  assert.equal(v!.label, "Tue 9 Jun · 10:00");
  // The same instant is 08:00 in UTC — NOT an offered hour there — proving the offered
  // grid follows the interview zone, not a fixed server/UTC wall clock.
  assert.equal(offeredSlotFor(tenPrague, NOW, "UTC"), null, "08:00 is not an offered slot in UTC");
});

test("garbage and injection payloads are refused, never echoed into a label", () => {
  assert.equal(offeredSlotFor("<script>alert(1)</script>", NOW), null);
  assert.equal(offeredSlotFor("not-a-date", NOW), null);
  assert.equal(offeredSlotFor("", NOW), null);
  assert.equal(offeredSlotFor(undefined, NOW), null);
  assert.equal(offeredSlotFor("x".repeat(41), NOW), null);
});

test("everything proposeSlots offers passes offeredSlotFor — proposal and validation cannot drift", () => {
  for (const s of proposeSlots()) {
    const v = offeredSlotFor(s.value);
    assert.ok(v, `proposed slot ${s.value} must validate`);
    assert.equal(v!.label, s.label, "validation must mint the same label the proposal showed");
  }
});

test("a fully-booked horizon yields zero slots — the no-available-slots boundary (idea-5df8e10f)", () => {
  // Feed back every slot the horizon could ever offer as "taken": the busiest-
  // calendar edge. proposeSlots must report emptiness (so the route can flag the
  // recruiter), never invent a slot outside its own grid.
  const everySlot = proposeSlots([], 10_000).map((s) => s.value);
  assert.ok(everySlot.length > 0, "sanity: an open horizon offers some slots");
  assert.deepEqual(proposeSlots(everySlot), [], "every offerable slot taken ⇒ empty proposal");
  assert.deepEqual(proposeSlots(everySlot, 6), [], "and the default page is empty too");
});

test("the scheduling horizon is a single source of truth bounding every proposal", () => {
  assert.ok(SLOT_HORIZON_DAYS > 0, "horizon must be a positive number of days");
  // No proposed slot may fall beyond the horizon (+1 day of end-of-day slack):
  // proposeSlots' scan and offeredSlotFor's accept-window both derive from this
  // one constant, so widening it can never let the two drift.
  const horizonEndMs = Date.now() + (SLOT_HORIZON_DAYS + 1) * 86_400_000;
  for (const s of proposeSlots([], 10_000)) {
    assert.ok(Date.parse(s.value) <= horizonEndMs, `proposed slot ${s.value} stays within the horizon`);
  }
});

// --- Candidate "propose your own times" escalation (trust boundary) --------------
test("proposedSlotFor accepts ANY weekday working hour and mints a server-authored label", () => {
  // 11:30 is NOT an offered time (offeredSlotFor rejects it) but IS a sane business
  // hour — the escalation exists precisely to name times the fixed grid never offered.
  assert.equal(offeredSlotFor(utc(9, 11, 30), NOW, TZ), null, "sanity: 11:30 isn't an offered slot");
  const v = proposedSlotFor(utc(9, 11, 30), NOW, TZ); // Tue 9 Jun 11:30 UTC
  assert.ok(v, "a weekday working-hour time should validate as a proposal");
  assert.equal(v!.label, "Tue 9 Jun · 11:30", "label is server-authored from the instant");
  assert.equal(v!.value, utc(9, 11, 30));
});

test("proposedSlotFor refuses past, weekend, out-of-hours, off-horizon, and garbage times", () => {
  assert.equal(proposedSlotFor(utc(8, 11), NOW, TZ), null, "past must be refused");
  assert.equal(proposedSlotFor(utc(13, 11), NOW, TZ), null, "Saturday must be refused");
  assert.equal(proposedSlotFor(utc(9, 7), NOW, TZ), null, "07:00 is before business hours");
  assert.equal(proposedSlotFor(utc(9, 18), NOW, TZ), null, "18:00 is at/after the business-hours end");
  assert.ok(proposedSlotFor(utc(9, 17, 30), NOW, TZ), "17:30 is inside business hours");
  assert.equal(proposedSlotFor(new Date(Date.UTC(2026, 6, 14, 11, 0, 0, 0)).toISOString(), NOW, TZ), null, "beyond the horizon must be refused");
  assert.equal(proposedSlotFor("<script>alert(1)</script>", NOW, TZ), null);
  assert.equal(proposedSlotFor("not-a-date", NOW, TZ), null);
  assert.equal(proposedSlotFor(undefined, NOW, TZ), null);
});

test("validateProposedSlots bounds the batch (1..MAX_PROPOSALS), dedupes, and rejects any bad time", () => {
  const a = utc(9, 11); // Tue 11:00
  const b = utc(9, 15); // Tue 15:00
  const c = utc(10, 9); // Wed 09:00
  assert.equal(validateProposedSlots([], NOW, TZ), null, "empty batch is invalid");
  assert.equal(validateProposedSlots([a, b, c, a], NOW, TZ), null, "over MAX_PROPOSALS is invalid");
  assert.equal(validateProposedSlots([a, utc(13, 11)], NOW, TZ), null, "any weekend time voids the whole batch");
  const ok = validateProposedSlots([a, b], NOW, TZ);
  assert.ok(ok, "a valid batch validates");
  assert.deepEqual(ok!.map((s) => s.value), [a, b], "server-authored values in input order");
  const deduped = validateProposedSlots([a, a, b], NOW, TZ);
  assert.deepEqual(deduped!.map((s) => s.value), [a, b], "an exact duplicate instant is dropped");
  assert.equal(MAX_PROPOSALS, 3);
});

// --- Direction 1: invite link TTL / expiry (derived, pure) ----------------------
test("isScheduleInviteExpired: only a stale, still-pending link expires", () => {
  const NOW = Date.parse("2026-06-10T12:00:00.000Z");
  const ttlMs = INVITE_LINK_TTL_DAYS * 86_400_000;
  const stale = new Date(NOW - ttlMs - 60_000).toISOString();
  const fresh = new Date(NOW - 60_000).toISOString();
  // Pending + older than the TTL → expired.
  assert.equal(isScheduleInviteExpired({ status: "pending", createdAt: stale }, NOW), true);
  // Pending but fresh → live.
  assert.equal(isScheduleInviteExpired({ status: "pending", createdAt: fresh }, NOW), false);
  // A confirmed booking never ages out this way, however old the link.
  assert.equal(isScheduleInviteExpired({ status: "confirmed", createdAt: stale }, NOW), false);
  // Already-terminal statuses are not "expired" (they have their own fate).
  assert.equal(isScheduleInviteExpired({ status: "declined", createdAt: stale }, NOW), false);
  assert.equal(isScheduleInviteExpired({ status: "no_show", createdAt: stale }, NOW), false);
  // Exactly at the boundary is not yet expired (strict <).
  const boundary = new Date(NOW - ttlMs).toISOString();
  assert.equal(isScheduleInviteExpired({ status: "pending", createdAt: boundary }, NOW), false);
});

// --- Direction 3: grid ⇄ canonical instant (one scheduling engine) --------------
test("gridSlotToIso resolves a grid pick to the next future canonical instant", () => {
  // NOW = Monday 2026-06-08 12:00 UTC (see top of file), interview zone pinned to UTC.
  const tue = gridSlotToIso("Tue 14:00", NOW, TZ);
  assert.ok(tue, "Tuesday 14:00 should resolve");
  assert.equal(tue!.value, new Date(Date.UTC(2026, 5, 9, 14, 0)).toISOString());
  assert.equal(tue!.label, "Tue 9 Jun · 14:00");
  // Same-day, still-future time books today.
  assert.equal(gridSlotToIso("Mon 14:00", NOW, TZ)!.value, new Date(Date.UTC(2026, 5, 8, 14, 0)).toISOString());
  // Same weekday but the time already passed → rolls to next week.
  assert.equal(gridSlotToIso("Mon 09:00", NOW, TZ)!.value, new Date(Date.UTC(2026, 5, 15, 9, 0)).toISOString());
  // A recruiter hour outside the candidate offered set (09:00) is still allowed.
  assert.ok(gridSlotToIso("Wed 09:00", NOW, TZ), "recruiter may pick any business-day hour");
});

test("gridSlotToIso refuses weekends and malformed picks", () => {
  assert.equal(gridSlotToIso("Sat 10:00", NOW, TZ), null);
  assert.equal(gridSlotToIso("Sun 10:00", NOW, TZ), null);
  assert.equal(gridSlotToIso("Xyz 10:00", NOW, TZ), null);
  assert.equal(gridSlotToIso("Tue 25:00", NOW, TZ), null);
  assert.equal(gridSlotToIso("garbage", NOW, TZ), null);
});

test("isoToGridSlot places an instant back on the grid and round-trips with gridSlotToIso", () => {
  assert.equal(isoToGridSlot(new Date(Date.UTC(2026, 5, 9, 14, 0)).toISOString(), TZ), "Tue 14:00");
  assert.equal(isoToGridSlot(new Date(Date.UTC(2026, 5, 13, 10, 0)).toISOString(), TZ), null, "Saturday maps to no grid cell");
  const resolved = gridSlotToIso("Thu 10:00", NOW, TZ);
  assert.equal(isoToGridSlot(resolved!.value, TZ), "Thu 10:00", "grid → iso → grid is stable");
  // An OFF-HOUR booking keeps its true minutes (Direction 2) — the grid buckets it into
  // the hour cell for display, but the stored instant/cell is honest about the minute.
  assert.equal(isoToGridSlot(new Date(Date.UTC(2026, 5, 9, 14, 30)).toISOString(), TZ), "Tue 14:30");
});

// --- The grid gets real dates: dated resolution + the concrete week pager -----------
test("dateSlotToIso resolves a DATED pick to the exact calendar instant (not the next weekday)", () => {
  // NOW = Monday 2026-06-08 12:00 UTC. Two different real Tuesdays no longer collapse:
  // the pick names the true day, so the 9th and the 16th are distinct instants.
  const t9 = dateSlotToIso("2026-06-09", "14:00", NOW, TZ);
  const t16 = dateSlotToIso("2026-06-16", "14:00", NOW, TZ);
  assert.ok(t9 && t16, "both dated Tuesdays resolve");
  assert.equal(t9!.value, new Date(Date.UTC(2026, 5, 9, 14, 0)).toISOString());
  assert.equal(t16!.value, new Date(Date.UTC(2026, 5, 16, 14, 0)).toISOString());
  assert.notEqual(t9!.value, t16!.value, "distinct calendar dates are distinct instants");
  assert.equal(t9!.label, "Tue 9 Jun · 14:00", "server-authored dated label");
  // Recruiter may pick any business-day hour (not just the offered 10:00/14:00).
  assert.ok(dateSlotToIso("2026-06-10", "09:00", NOW, TZ), "any weekday business hour is allowed");
});

test("dateSlotToIso refuses past, weekend, off-horizon, and malformed dated picks", () => {
  assert.equal(dateSlotToIso("2026-06-08", "10:00", NOW, TZ), null, "a past instant (this morning) is refused");
  assert.equal(dateSlotToIso("2026-06-13", "10:00", NOW, TZ), null, "Saturday is refused");
  assert.equal(dateSlotToIso("2026-06-14", "10:00", NOW, TZ), null, "Sunday is refused");
  assert.equal(dateSlotToIso("2026-07-14", "10:00", NOW, TZ), null, "beyond the horizon is refused");
  assert.equal(dateSlotToIso("garbage", "10:00", NOW, TZ), null);
  assert.equal(dateSlotToIso("2026-06-09", "25:00", NOW, TZ), null);
  assert.equal(dateSlotToIso("2026-06-09", "", NOW, TZ), null);
});

test("isoToDateSlot places an instant on the dated grid and round-trips with dateSlotToIso", () => {
  const iso = new Date(Date.UTC(2026, 5, 9, 14, 0)).toISOString();
  assert.equal(isoToDateSlot(iso, TZ), "2026-06-09 14:00");
  const [date, time] = isoToDateSlot(iso, TZ)!.split(" ");
  assert.equal(dateSlotToIso(date, time, NOW, TZ)!.value, iso, "dated → iso → dated is stable");
  // Off-hour booking keeps its true minutes; the grid buckets it into the hour row.
  assert.equal(isoToDateSlot(new Date(Date.UTC(2026, 5, 9, 14, 30)).toISOString(), TZ), "2026-06-09 14:30");
  assert.equal(isoToDateSlot(new Date(Date.UTC(2026, 5, 13, 10, 0)).toISOString(), TZ), null, "Saturday maps to no cell");
});

test("scheduleGridWeeks spans the offer horizon in concrete weekday dates, marking past days", () => {
  const weeks = scheduleGridWeeks(NOW, TZ); // NOW = Monday 2026-06-08
  assert.ok(weeks.length >= 3, "the pager covers multiple weeks across the ~3-week horizon");
  // Every inner week is Mon–Fri (5 weekdays), never a weekend.
  for (const w of weeks) {
    assert.equal(w.length, 5, "five weekdays per week");
    for (const d of w) assert.ok(d.weekday >= 1 && d.weekday <= 5, "no weekend column");
  }
  // The first week contains today (Monday the 8th) and it is not past.
  const first = weeks[0];
  const monday = first.find((d) => d.iso === "2026-06-08");
  assert.ok(monday, "today sits in the first week");
  assert.equal(monday!.past, false, "today is not disabled");
  // No date runs beyond the horizon end (today + SLOT_HORIZON_DAYS).
  const last = weeks[weeks.length - 1];
  const horizonEnd = Date.UTC(2026, 5, 8) + (SLOT_HORIZON_DAYS + 6) * 86_400_000; // + trailing Fri slack
  assert.ok(Date.UTC(last[4].year, last[4].month - 1, last[4].day) <= horizonEnd, "no week extends unboundedly past the horizon");
});

test("scheduleGridWeeks marks days before today as past (disabled) in a mid-week start", () => {
  // Start on Wednesday 2026-06-10: Mon/Tue of that week are past, Wed onward are live.
  const wed = Date.UTC(2026, 5, 10, 12, 0, 0, 0);
  const weeks = scheduleGridWeeks(wed, TZ);
  const week0 = weeks[0];
  assert.equal(week0.find((d) => d.iso === "2026-06-08")!.past, true, "Monday before today is past");
  assert.equal(week0.find((d) => d.iso === "2026-06-09")!.past, true, "Tuesday before today is past");
  assert.equal(week0.find((d) => d.iso === "2026-06-10")!.past, false, "today is live");
  assert.equal(week0.find((d) => d.iso === "2026-06-11")!.past, false, "future day in the same week is live");
});

// --- Direction 2: hour-bucketing so off-hour bookings don't vanish from the grid ---
test("hourBucketKey buckets an instant by its interview-zone day+hour (off-hour shares the hour)", () => {
  const onHour = new Date(Date.UTC(2026, 5, 9, 14, 0)).toISOString();
  const offHour = new Date(Date.UTC(2026, 5, 9, 14, 30)).toISOString();
  // 14:00 and 14:30 on the same day share one bucket — the grid's hour is occupied.
  assert.equal(hourBucketKey(onHour, TZ), "2026-06-09T14");
  assert.equal(hourBucketKey(offHour, TZ), hourBucketKey(onHour, TZ), "14:00 and 14:30 share the hour bucket");
  // A different hour, or the same wall-clock hour on a different ACTUAL day, does not.
  assert.notEqual(hourBucketKey(new Date(Date.UTC(2026, 5, 9, 15, 0)).toISOString(), TZ), hourBucketKey(onHour, TZ));
  assert.notEqual(hourBucketKey(new Date(Date.UTC(2026, 5, 16, 14, 30)).toISOString(), TZ), hourBucketKey(onHour, TZ), "next Wednesday is a different bucket — no weekday false-collision");
  assert.equal(hourBucketKey(null, TZ), null);
  assert.equal(hourBucketKey("garbage", TZ), null);
});
