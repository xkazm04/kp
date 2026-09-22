// THE BOOKING COLLISION IS A REAL-DURATION OVERLAP, HELD INSIDE THE STORE'S TRANSACTION
// (challenge 2026-09-22, calendar-scheduling/A).
//
// The store's collision authority used to be exact-instant equality (`slot_at = ?`), which
// was sound only while every booking sat on the fixed KP_INTERVIEW_TIMES grid at one length.
// The pool it guards now holds off-grid minutes (a recruiter grid pick, an accepted 14:30
// proposal) and per-invite durations (a 22-minute student screen, a 90-minute panel), so a
// 14:30 booked beside a 14:00, and a 15:00 inside a 90-minute 14:00, both landed. The one
// route that noticed patched it with a pre-read OUTSIDE the transaction.
//
// These cases pin the invariant where it now lives: `bookingCollides` (pure) and the two
// `.immediate()` transactions that call it.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts). The interview zone is pinned to UTC BEFORE schedule-slots loads
// (INTERVIEW_TZ is read at module evaluation) so the hour arithmetic below is literal.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.KP_INTERVIEW_TZ = "UTC";
delete process.env.KP_INTERVIEW_TIMES;

const { bookingCollides, proposeSlots } = await import("./schedule-slots.ts");
const { createScheduleInvite, confirmScheduleInvite, rescheduleScheduleInvite, bookedIntervals } = await import(
  "./schedule-store.ts"
);

after(() => cleanupUnitDb());

/** A fixed far-future weekday per case (the store does not re-validate the offer
 *  window), so no two cases share a day and none can collide with another's booking. */
const at = (day: number, h: number, m = 0) => new Date(Date.UTC(2030, 2, day, h, m, 0, 0)).toISOString();

let seq = 0;
function invite(durationMin: number | null): string {
  seq += 1;
  return createScheduleInvite({
    entryId: `collide-e${seq}`,
    candidateLabel: `Collide ${seq}`,
    jobTitle: "Role",
    durationMin,
  }).token;
}

function confirmedAt(slotAt: string, durationMin: number | null): string {
  const token = invite(durationMin);
  const r = confirmScheduleInvite(token, slotAt, slotAt);
  assert.equal(r.ok, true, "fixture booking must land");
  return token;
}

test("a 90-minute 14:00 refuses a 15:00 booking — the real intervals overlap across the hour", () => {
  confirmedAt(at(11, 14), 90);
  const b = invite(45);
  const r = confirmScheduleInvite(b, "x", at(11, 15));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : r.reason, "taken");
});

test("a 14:30 is refused beside a 45-minute 14:00 — same interview-zone hour", () => {
  confirmedAt(at(12, 14), 45);
  const b = invite(45);
  const r = confirmScheduleInvite(b, "x", at(12, 14, 30));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : r.reason, "taken");
});

test("no false collision: a 45-minute 10:00 leaves 14:00 bookable", () => {
  confirmedAt(at(13, 10), 45);
  const b = invite(45);
  const r = confirmScheduleInvite(b, "x", at(13, 14));
  assert.equal(r.ok, true);
});

test("a reschedule overlapping ONLY the invite's own current booking moves", () => {
  const a = confirmedAt(at(14, 14), 45);
  const r = rescheduleScheduleInvite(a, "x", at(14, 14, 30));
  assert.equal(r.ok, true, "the own row is excluded from the overlap set");
  assert.equal(r.ok ? r.invite.slotAt : null, at(14, 14, 30));
});

test("a reschedule INTO another invite's real interval is refused", () => {
  confirmedAt(at(15, 9), 120); // 09:00–11:00
  const mover = confirmedAt(at(15, 14), 45);
  const r = rescheduleScheduleInvite(mover, "x", at(15, 10, 30));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? null : r.reason, "taken");
});

test("a legacy confirmed row with a NULL duration is 45 minutes of overlap, not zero", () => {
  confirmedAt(at(18, 14, 30), null); // 14:30–15:15 under the default
  const b = invite(45);
  const r = confirmScheduleInvite(b, "x", at(18, 15));
  assert.equal(r.ok, false, "15:00 sits inside a default-length 14:30");
  assert.equal(r.ok ? null : r.reason, "taken");
});

test("bookedIntervals carries each booking's duration (null → the default)", () => {
  const rows = bookedIntervals();
  const legacy = rows.find((r) => r.slotAt === at(18, 14, 30));
  assert.ok(legacy, "the legacy booking is in the pool");
  assert.equal(legacy!.durationMin, 45);
  const long = rows.find((r) => r.slotAt === at(11, 14));
  assert.equal(long!.durationMin, 90);
});

test("pure: bookingCollides is a half-open interval OR the same interview-zone hour", () => {
  const tz = "UTC";
  const a = { slotAt: at(19, 14), durationMin: 45 };
  assert.equal(bookingCollides({ slotAt: at(19, 14, 45), durationMin: 30 }, [a], tz), true, "same hour 14");
  assert.equal(bookingCollides({ slotAt: at(19, 15), durationMin: 30 }, [a], tz), false, "back-to-back is not a clash");
  assert.equal(bookingCollides({ slotAt: at(19, 13, 30), durationMin: 45 }, [a], tz), true, "13:30–14:15 overlaps");
  assert.equal(bookingCollides({ slotAt: at(19, 13), durationMin: 60 }, [a], tz), false, "13:00–14:00 ends as A starts");
  assert.equal(bookingCollides({ slotAt: at(19, 16), durationMin: null }, [{ slotAt: at(19, 15), durationMin: null }], tz), false);
  assert.equal(bookingCollides({ slotAt: at(19, 15, 30), durationMin: null }, [{ slotAt: at(19, 14, 50), durationMin: null }], tz), true, "null → 45");
  assert.equal(bookingCollides({ slotAt: "not-a-date", durationMin: 45 }, [a], tz), false, "unparsable never collides");
});

test("pure: proposeSlots hides a grid time an off-grid interval overlaps; legacy strings keep working", () => {
  const offered = proposeSlots([], 10, "UTC");
  const fourteen = offered.find((s) => s.value.endsWith("T14:00:00.000Z"));
  assert.ok(fourteen, "the default grid offers a 14:00");
  const day = fourteen!.value.slice(0, 10);
  const halfPastOne = `${day}T13:30:00.000Z`;

  const withInterval = proposeSlots([{ slotAt: halfPastOne, durationMin: 60 }], 10, "UTC").map((s) => s.value);
  assert.equal(withInterval.includes(fourteen!.value), false, "13:30–14:30 overlaps 14:00, so 14:00 is not offered");
  assert.equal(withInterval.includes(`${day}T10:00:00.000Z`), true, "the morning slot that day is untouched");

  const legacy = proposeSlots([halfPastOne], 10, "UTC").map((s) => s.value);
  assert.equal(legacy.includes(fourteen!.value), true, "a bare string keeps its exact-instant meaning");
  const legacyExact = proposeSlots([fourteen!.value], 10, "UTC").map((s) => s.value);
  assert.equal(legacyExact.includes(fourteen!.value), false, "and still hides its own instant");
});
