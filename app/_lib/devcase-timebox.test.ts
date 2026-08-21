// The devcase timebox is the cap on a candidate's UNPAID work, and it renders verbatim
// to them. It was enforced in exactly one writer (the Python designer's clamp of the
// LLM estimate) while the human approve gate accepted `timeboxHours <= 80` — forty
// times the cap — and the Pydantic default sat at double it. These pin the TS half of
// the shared rule, including that the bound is IMPORTED from the generated Python
// constant rather than re-typed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTimeboxHours, DEVCASE_MAX_TIMEBOX_HOURS, DEVCASE_MIN_TIMEBOX_HOURS } from "./devcase-timebox.ts";

test("the shared bounds match the Python policy numbers", () => {
  assert.equal(DEVCASE_MAX_TIMEBOX_HOURS, 2);
  assert.equal(DEVCASE_MIN_TIMEBOX_HOURS, 0.5);
});

test("an over-cap reviewer edit is clamped, not accepted", () => {
  // The old validator's own ceiling, and the typo it was meant to survive.
  assert.equal(clampTimeboxHours(80), DEVCASE_MAX_TIMEBOX_HOURS);
  assert.equal(clampTimeboxHours(40), DEVCASE_MAX_TIMEBOX_HOURS);
  assert.equal(clampTimeboxHours(2.5), DEVCASE_MAX_TIMEBOX_HOURS);
});

test("a degenerate or negative timebox is floored so it can't render '~0h'", () => {
  assert.equal(clampTimeboxHours(0), DEVCASE_MIN_TIMEBOX_HOURS);
  assert.equal(clampTimeboxHours(-3), DEVCASE_MIN_TIMEBOX_HOURS);
});

test("an in-band edit passes through untouched", () => {
  assert.equal(clampTimeboxHours(1.5), 1.5);
  assert.equal(clampTimeboxHours(0.5), 0.5);
  assert.equal(clampTimeboxHours(2), 2);
});

test("a non-numeric edit carries no intent and is dropped, not coerced", () => {
  assert.equal(clampTimeboxHours(NaN), null);
  assert.equal(clampTimeboxHours(Infinity), null);
  assert.equal(clampTimeboxHours(null), null);
  assert.equal(clampTimeboxHours(undefined), null);
  assert.equal(clampTimeboxHours({}), null);
});
