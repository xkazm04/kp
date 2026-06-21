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
import { offeredSlotFor, proposeSlots, SLOT_HORIZON_DAYS } from "./schedule-slots.ts";

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
