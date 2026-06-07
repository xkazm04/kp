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
import { offeredSlotFor, proposeSlots } from "./schedule-slots.ts";

// Fixed local reference: Monday 2026-06-08 12:00 local time.
const NOW = new Date(2026, 5, 8, 12, 0, 0, 0).getTime();
const local = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m, 0, 0).toISOString();

test("a slot the server would offer validates and gets the canonical server-minted label", () => {
  const tue10 = offeredSlotFor(local(9, 10), NOW); // Tue 9 Jun · 10:00
  assert.ok(tue10, "expected Tuesday 10:00 to validate");
  assert.equal(tue10!.label, "Tue 9 Jun · 10:00");
  assert.equal(tue10!.value, local(9, 10));
  assert.ok(offeredSlotFor(local(10, 14), NOW), "expected Wednesday 14:00 to validate");
});

test("past, weekend, out-of-window, and off-grid times are refused", () => {
  assert.equal(offeredSlotFor(local(8, 10), NOW), null, "this morning (past) must be refused");
  assert.equal(offeredSlotFor(local(13, 10), NOW), null, "Saturday must be refused");
  assert.equal(offeredSlotFor(local(14, 10), NOW), null, "Sunday must be refused");
  assert.equal(offeredSlotFor(new Date(2026, 6, 14, 10, 0, 0, 0).toISOString(), NOW), null, "beyond the proposal window must be refused");
  assert.equal(offeredSlotFor(local(9, 10, 30), NOW), null, "10:30 is not an offered time");
  assert.equal(offeredSlotFor(local(9, 9), NOW), null, "09:00 is not an offered time");
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
