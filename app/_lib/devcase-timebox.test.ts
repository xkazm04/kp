// The devcase timebox is the cap on a candidate's UNPAID work, and it renders verbatim
// to them. It was enforced in exactly one writer (the Python designer's clamp of the
// LLM estimate) while the human approve gate accepted `timeboxHours <= 80` — forty
// times the cap — and the Pydantic default sat at double it. These pin the TS half of
// the shared rule, including that the bound is IMPORTED from the generated Python
// constant rather than re-typed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampTimeboxHours,
  DEVCASE_MAX_TIMEBOX_HOURS,
  DEVCASE_MIN_TIMEBOX_HOURS,
  TIMEBOX_CLAMPED_CODE,
  timeboxClamp,
  timeboxHoursForDisplay,
} from "./devcase-timebox.ts";

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

// The reviewer types 8, sees 8, and the candidate gets 2. The clamp is only honest if
// the SAME producer that rewrites the number also describes the rewrite, structurally,
// to both the reviewer's screen and the audit trail.
test("a clamped edit is described structurally, with the value the candidate will get", () => {
  assert.deepEqual(timeboxClamp(8), { code: TIMEBOX_CLAMPED_CODE, from: 8, to: DEVCASE_MAX_TIMEBOX_HOURS });
  assert.deepEqual(timeboxClamp("8"), { code: TIMEBOX_CLAMPED_CODE, from: 8, to: DEVCASE_MAX_TIMEBOX_HOURS });
  assert.deepEqual(timeboxClamp(0), { code: TIMEBOX_CLAMPED_CODE, from: 0, to: DEVCASE_MIN_TIMEBOX_HOURS });
});

test("an in-band or unparseable edit describes no clamp", () => {
  assert.equal(timeboxClamp(1.5), null);
  assert.equal(timeboxClamp(DEVCASE_MAX_TIMEBOX_HOURS), null);
  assert.equal(timeboxClamp("nonsense"), null);
  assert.equal(timeboxClamp(undefined), null);
});

test("a missing timebox displays the cap, never the stale over-policy default", () => {
  assert.equal(timeboxHoursForDisplay(undefined), DEVCASE_MAX_TIMEBOX_HOURS);
  assert.equal(timeboxHoursForDisplay(null), DEVCASE_MAX_TIMEBOX_HOURS);
  assert.notEqual(timeboxHoursForDisplay(undefined), 4);
  assert.equal(timeboxHoursForDisplay(1), 1);
  assert.equal(timeboxHoursForDisplay(80), DEVCASE_MAX_TIMEBOX_HOURS);
});
