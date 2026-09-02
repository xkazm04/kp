// A GUESSED SLOT MUST NOT LOOK LIKE A CONFIRMED ONE (/perfect 2026-09-02, schedule-ui-1).
//
// The grid seeds a candidate's cell from a confirmed invite, else a legacy free-text
// detail, else a flat "Tue 14:00" default — and rendered all three identically, so the
// recruiter could not tell which chips were facts. These pin the classification the UI
// draws from; the drawing itself (a dashed chip, a "suggested" label) is one boolean
// away in isSuggested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSuggested, seedGrid, seedSlot } from "./scheduleGridSeeds.ts";

test("a confirmed invite's slot wins, and is the only source that counts as booked", () => {
  const seeded = seedSlot({
    id: "e1",
    fromInvite: "2026-09-08 14:00",
    fromLegacy: "2026-09-09 10:00",
    fallback: "2026-09-10 14:00",
  });
  assert.deepEqual(seeded, { slot: "2026-09-08 14:00", source: "booked" });
  assert.equal(isSuggested(seeded.source), false);
});

test("the legacy free-text detail is a SUGGESTION, not a booking", () => {
  const seeded = seedSlot({ id: "e2", fromInvite: null, fromLegacy: "2026-09-09 10:00", fallback: "2026-09-10 14:00" });
  assert.deepEqual(seeded, { slot: "2026-09-09 10:00", source: "legacy" });
  assert.equal(isSuggested(seeded.source), true, "nobody agreed to this time — it must read as a guess");
});

test("the flat default is the weakest claim of all", () => {
  const seeded = seedSlot({ id: "e3", fromInvite: null, fromLegacy: null, fallback: "2026-09-10 14:00" });
  assert.deepEqual(seeded, { slot: "2026-09-10 14:00", source: "guess" });
  assert.equal(isSuggested(seeded.source), true);
});

test("an unknown entry is treated as a suggestion, never as booked", () => {
  // The failure mode that matters: a missing entry in the provenance record must not
  // fall through to "confirmed". Absence of evidence is not a booking.
  assert.equal(isSuggested(undefined), true);
});

test("seedGrid builds the two records in one pass, so they cannot drift", () => {
  const { picks, sources } = seedGrid([
    { id: "a", fromInvite: "2026-09-08 09:00", fromLegacy: null, fallback: "2026-09-10 14:00" },
    { id: "b", fromInvite: null, fromLegacy: "2026-09-08 11:00", fallback: "2026-09-10 14:00" },
    { id: "c", fromInvite: null, fromLegacy: null, fallback: "2026-09-10 14:00" },
  ]);
  assert.deepEqual(picks, { a: "2026-09-08 09:00", b: "2026-09-08 11:00", c: "2026-09-10 14:00" });
  assert.deepEqual(sources, { a: "booked", b: "legacy", c: "guess" });
  assert.deepEqual(Object.keys(picks), Object.keys(sources), "every pick carries a provenance");
});
