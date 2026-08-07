import { test } from "node:test";
import assert from "node:assert/strict";
import { busyQueryWindow, filterFreeSlots, isSlotFree, normalizeBusy } from "./free-busy.ts";

// 2026-03-02 is a Monday. All times UTC for readability.
const at = (h: number, m = 0) => `2026-03-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const busy = (h1: number, h2: number) => ({ start: at(h1), end: at(h2) });

test("a slot inside a meeting is busy", () => {
  assert.equal(isSlotFree([busy(9, 10)], at(9, 30), 30), false);
});

test("a slot with no overlap is free", () => {
  assert.equal(isSlotFree([busy(9, 10)], at(14), 45), true);
  assert.equal(isSlotFree([], at(9, 30), 45), true);
});

test("touching boundaries are FREE on both sides", () => {
  // The most common real booking is the one right after the standup — refusing it would
  // make the feature feel broken.
  assert.equal(isSlotFree([busy(9, 10)], at(10), 45), true, "starting exactly when a meeting ends");
  assert.equal(isSlotFree([busy(10, 11)], at(9, 15), 45), true, "ending exactly when one starts");
  // One minute of genuine overlap on either side is busy.
  assert.equal(isSlotFree([busy(10, 11)], at(9, 16), 45), false);
  assert.equal(isSlotFree([busy(9, 10)], at(9, 59), 45), false);
});

test("a long meeting swallows a slot that starts before it", () => {
  assert.equal(isSlotFree([busy(9, 17)], at(8, 45), 45), false);
});

test("duration matters, not just the start time", () => {
  // 09:30 is free for 15 minutes but not for 45 — the difference between a screen and a
  // full interview landing on the same calendar.
  assert.equal(isSlotFree([busy(10, 11)], at(9, 30), 15), true);
  assert.equal(isSlotFree([busy(10, 11)], at(9, 30), 45), false);
});

test("garbage busy data is DROPPED rather than blocking the day", () => {
  // A provider hiccup must not silently empty availability — that surfaces as "no slots"
  // with no explanation. One lost interval risks a double booking a human can fix.
  assert.equal(isSlotFree([{ start: "nonsense", end: "also nonsense" }], at(9, 30), 45), true);
  assert.equal(isSlotFree([{ start: at(11), end: at(9) }], at(11, 30), 45), true, "an inverted interval is not trusted");
  assert.equal(isSlotFree([{ start: at(9), end: at(9) }], at(9), 45), true, "a zero-length interval blocks nothing");
});

test("an unparseable SLOT is busy — the inverse stance, deliberately", () => {
  // Bad provider data must not erase availability; a slot we cannot place in time must
  // never be offered as confirmed-free.
  assert.equal(isSlotFree([], "not a date", 45), false);
});

test("overlapping and adjacent busy spans merge", () => {
  //          overlapping ────┐        ┌──── adjacent (10:00 starts exactly at 10:00)
  const merged = normalizeBusy([busy(9, 10), { start: at(9, 30), end: at(10) }, busy(10, 11)]);
  assert.equal(merged.length, 1, "adjacent meetings leave no real gap");
  assert.equal(new Date(merged[0].startMs).toISOString(), at(9));
  assert.equal(new Date(merged[0].endMs).toISOString(), at(11));

  const separate = normalizeBusy([busy(14, 15), busy(9, 10)]);
  assert.equal(separate.length, 2);
  assert.equal(new Date(separate[0].startMs).toISOString(), at(9), "output is sorted");
});

test("filterFreeSlots reports how many were dropped, not just what survived", () => {
  // "3 slots" and "3 of 6, the rest clashed" read very differently to a recruiter.
  const slots = [{ value: at(9) }, { value: at(9, 30) }, { value: at(14) }];
  const res = filterFreeSlots(slots, [busy(9, 10)], 45);
  assert.deepEqual(
    res.free.map((s) => s.value),
    [at(14)]
  );
  assert.equal(res.droppedForConflict, 2);
});

test("no busy data means every slot survives untouched", () => {
  const slots = [{ value: at(9) }, { value: at(14) }];
  const res = filterFreeSlots(slots, []);
  assert.equal(res.free.length, 2);
  assert.equal(res.droppedForConflict, 0);
});

test("the query window spans the slots and nothing more", () => {
  // A free/busy query must not pull more of someone's calendar than the decision needs.
  const w = busyQueryWindow([{ value: at(14) }, { value: at(9) }], 45);
  assert.equal(w?.timeMin, at(9));
  assert.equal(w?.timeMax, at(14, 45));
  assert.equal(busyQueryWindow([]), null);
  assert.equal(busyQueryWindow([{ value: "nope" }]), null);
});
