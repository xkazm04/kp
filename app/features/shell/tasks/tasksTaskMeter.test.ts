// Pins the Background-tasks meter rules: 5 bars per row, a second row only on
// spill, saturate at 10 and never grow a third row however deep the queue gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { METER_BARS_PER_ROW, METER_MAX_BARS, taskMeterRows } from "./tasksTaskMeter.ts";

test("idle shows a single row with nothing filled", () => {
  assert.deepEqual(taskMeterRows(0), [0]);
});

test("the first five tasks fill the first row one bar at a time", () => {
  for (let n = 1; n <= METER_BARS_PER_ROW; n++) {
    assert.deepEqual(taskMeterRows(n), [n], `${n} running fills ${n} bars in one row`);
  }
});

test("the sixth task opens a second row with exactly the spill filled", () => {
  assert.deepEqual(taskMeterRows(6), [5, 1]);
  assert.deepEqual(taskMeterRows(9), [5, 4]);
});

test("ten tasks fill both rows completely", () => {
  assert.deepEqual(taskMeterRows(METER_MAX_BARS), [5, 5]);
});

test("past ten the meter stays full — never a third row, never an 11th bar", () => {
  for (const n of [11, 12, 47, 1000]) {
    assert.deepEqual(taskMeterRows(n), [5, 5], `${n} running still reads as a full meter`);
  }
});

test("garbage counts read as idle instead of rendering NaN bars", () => {
  // Non-finite counts can only come from a bug upstream, so they read as idle
  // (an empty meter) rather than as a saturated one that would cry wolf.
  for (const bad of [-1, -50, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(taskMeterRows(bad), [0], `${String(bad)} is treated as idle`);
  }
});

test("a fractional count never lights a partial bar", () => {
  assert.deepEqual(taskMeterRows(2.9), [2]);
  assert.deepEqual(taskMeterRows(7.5), [5, 2]);
});

test("no row ever exceeds the per-row bar count", () => {
  for (let n = 0; n <= 25; n++) {
    const rows = taskMeterRows(n);
    assert.ok(rows.length <= 2, `${n} running renders at most 2 rows`);
    for (const filled of rows) {
      assert.ok(filled >= 0 && filled <= METER_BARS_PER_ROW, `${n} running: ${filled} is a valid row fill`);
    }
  }
});
