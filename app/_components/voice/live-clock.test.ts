import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLiveClock, formatMmSs, remainingSeconds } from "./live-clock.ts";

test("elapsed 60s with durationMin 8 renders remaining 7:00", () => {
  const clock = formatLiveClock(60, 8);
  assert.equal(clock.elapsed, "1:00");
  assert.equal(clock.remaining, "7:00");
  assert.equal(remainingSeconds(60, 8), 420);
});

test("without durationMin the clock is elapsed only", () => {
  const clock = formatLiveClock(60);
  assert.equal(clock.elapsed, "1:00");
  assert.equal(clock.remaining, null);
  assert.equal(remainingSeconds(60, undefined), null);
});

test("remaining clamps at 0 once the booked duration is spent", () => {
  assert.equal(formatLiveClock(8 * 60, 8).remaining, "0:00");
  assert.equal(formatLiveClock(9 * 60, 8).remaining, "0:00");
});

test("non-positive or non-finite durationMin is treated as unknown", () => {
  assert.equal(formatLiveClock(30, 0).remaining, null);
  assert.equal(formatLiveClock(30, -5).remaining, null);
  assert.equal(formatLiveClock(30, Number.NaN).remaining, null);
});

test("formatMmSs pads seconds and never goes negative", () => {
  assert.equal(formatMmSs(0), "0:00");
  assert.equal(formatMmSs(9), "0:09");
  assert.equal(formatMmSs(-12), "0:00");
});
