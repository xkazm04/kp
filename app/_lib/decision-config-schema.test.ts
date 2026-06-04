// Pins the decision-config write contract (idea-55baa5da) and the small-cohort
// auto-reject rounding policy (idea-582ff3b2). Both live in the pure,
// DB-free decision-config-schema module so they can be exercised here directly.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCREENING_DEFAULT,
  screenBottomCount,
  validateDecisionConfig,
} from "./decision-config-schema.ts";

// A fresh, fully-valid screening rule per call so a test can mutate one field.
function validRule() {
  return { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 45 };
}

test("accepts a well-formed screening rule and returns the typed config", () => {
  const result = validateDecisionConfig("screening", validRule());
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.phase, "screening");
  assert.deepEqual(result.config, { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 45 });
});

test("the shipped default validates (the validator is idempotent on good input)", () => {
  const result = validateDecisionConfig("screening", { ...SCREENING_DEFAULT });
  assert.ok(result.ok);
  assert.deepEqual(result.config, SCREENING_DEFAULT);
});

test("clamps out-of-range but coercible numbers to 0–100 instead of rejecting", () => {
  const high = validateDecisionConfig("screening", { ...validRule(), rejectBottomPercent: 9999 });
  assert.ok(high.ok);
  assert.equal(high.config.rejectBottomPercent, 100, "9999% clamps to 100");

  const low = validateDecisionConfig("screening", { ...validRule(), maxMatchToReject: -5 });
  assert.ok(low.ok);
  assert.equal(low.config.maxMatchToReject, 0, "a negative threshold clamps to 0");
});

test("rejects an unknown decision phase with a 400-worthy error", () => {
  const result = validateDecisionConfig("interview", validRule());
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /unknown decision phase/i.test(result.error));
});

test("rejects a non-object config (null, array, primitive)", () => {
  for (const bad of [null, undefined, [], "screening", 42, true]) {
    const result = validateDecisionConfig("screening", bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("rejects a stray/unknown field rather than persisting it", () => {
  const result = validateDecisionConfig("screening", { ...validRule(), rejectTopPercent: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /rejectTopPercent/.test(result.error));
});

test("rejects a wrong-typed value (string where a number is required)", () => {
  const result = validateDecisionConfig("screening", { ...validRule(), rejectBottomPercent: "20" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /rejectBottomPercent/.test(result.error));
});

test("rejects a non-boolean autoRejectEnabled", () => {
  const result = validateDecisionConfig("screening", { ...validRule(), autoRejectEnabled: "yes" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /autoRejectEnabled/.test(result.error));
});

test("rejects NaN / Infinity number fields", () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    const result = validateDecisionConfig("screening", { ...validRule(), maxMatchToReject: v });
    assert.equal(result.ok, false, `${v} should be rejected`);
  }
});

test("rejects a missing required field", () => {
  const { autoRejectEnabled, ...partial } = validRule();
  void autoRejectEnabled;
  const result = validateDecisionConfig("screening", partial);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /autoRejectEnabled/.test(result.error));
});

// --- small-cohort rounding policy (idea-582ff3b2): floor, min 1 in a non-empty
// pool when a positive percentage is configured ---

test("the bug case: bottom 20% of 4 is now 1, not 0", () => {
  // floor(0.8) used to be 0 — the role was silently exempt. Min-1 fixes it.
  assert.equal(screenBottomCount(4, 20), 1);
});

test("the smallest pools are no longer silently exempt", () => {
  assert.equal(screenBottomCount(1, 20), 1);
  assert.equal(screenBottomCount(2, 20), 1);
  assert.equal(screenBottomCount(3, 20), 1);
});

test("larger pools keep the plain floor behavior (min-1 only touches the zero case)", () => {
  assert.equal(screenBottomCount(10, 20), 2);
  assert.equal(screenBottomCount(12, 20), 2); // floor(2.4) = 2
  assert.equal(screenBottomCount(100, 20), 20);
});

test("an empty cohort or a 0% / negative percentage selects nobody", () => {
  assert.equal(screenBottomCount(0, 20), 0);
  assert.equal(screenBottomCount(5, 0), 0);
  assert.equal(screenBottomCount(5, -10), 0);
});

test("100% selects the whole cohort", () => {
  assert.equal(screenBottomCount(7, 100), 7);
});
