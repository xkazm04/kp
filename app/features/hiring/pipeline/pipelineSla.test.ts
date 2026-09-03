// The aging-SLA override's parse/clamp/clear rule.
//
// THE BUG THIS PINS. PipelineSlaEditor declared its range on the input
// (`min={1} max={365}`) and then ignored it: `parseInt` fed whatever was typed
// straight to `setStageSla`, which stored any positive number. A native number
// input's min/max are advisory — they colour the field, they do not stop a paste
// or an arrow-key overshoot — so a typed 5000 persisted to localStorage and
// silenced that column's aging chip for fourteen years, with the field showing
// the honest 5000 and nothing anywhere saying it was out of range.
//
// The clamp is now stated once, here, and both the editor and the store use it.
//
// Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLA_MAX_DAYS, SLA_MIN_DAYS, clampSlaDays } from "./pipelineSla.ts";

test("clampSlaDays: a value inside the declared range is kept exactly", () => {
  assert.equal(clampSlaDays("14"), 14);
  assert.equal(clampSlaDays(String(SLA_MIN_DAYS)), SLA_MIN_DAYS);
  assert.equal(clampSlaDays(String(SLA_MAX_DAYS)), SLA_MAX_DAYS);
});

test("clampSlaDays: an overshoot is clamped, never stored raw", () => {
  // The exact regression: a typed 5000 used to persist and silence aging.
  assert.equal(clampSlaDays("5000"), SLA_MAX_DAYS);
  assert.equal(clampSlaDays("1e9"), SLA_MAX_DAYS);
});

test("clampSlaDays: a sub-minimum value is clamped up rather than dropped", () => {
  // 0.4 days is a real intent ("age this column fast"), not garbage — it becomes
  // the smallest cadence the board can actually express.
  assert.equal(clampSlaDays("0.4"), SLA_MIN_DAYS);
});

test("clampSlaDays: an empty or unparseable field CLEARS the override", () => {
  // null is "back to the role's default", which is what the placeholder shows.
  assert.equal(clampSlaDays(""), null);
  assert.equal(clampSlaDays("   "), null);
  assert.equal(clampSlaDays("abc"), null);
  assert.equal(clampSlaDays("0"), null, "0 is not a cadence — it is a clear");
  assert.equal(clampSlaDays("-3"), null);
  assert.equal(clampSlaDays("NaN"), null);
});

test("clampSlaDays: fractional days round to the day the board actually counts in", () => {
  assert.equal(clampSlaDays("7.6"), 8);
  assert.equal(clampSlaDays("7.2"), 7);
});

test("SLA range is the one the editor's input declares", () => {
  assert.equal(SLA_MIN_DAYS, 1);
  assert.equal(SLA_MAX_DAYS, 365);
});
