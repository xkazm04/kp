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
  tieSafeBottomCount,
  validateDecisionConfig,
  validateScreeningOverride,
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

// --- deterministic tie-break at the auto-reject cutoff (idea-50062f77): never
// split a run of identical match scores across the bottom-% boundary; a tie that
// straddles it is resolved in the candidate's favour (the whole run is KEPT), so
// equal candidates always get the equal automated outcome regardless of the
// stable sort's incidental arrival order. Scores are ascending (worst first). ---

test("no tie at the boundary leaves the bottom count unchanged", () => {
  // Cutoff between rank 1 (20) and rank 2 (30) — distinct scores, nothing to do.
  assert.equal(tieSafeBottomCount([10, 20, 30, 40], 2), 2);
});

test("a tie straddling the cutoff shrinks it to the run's lower edge (tie kept)", () => {
  // bottom 2 would reject ranks 0,1 and keep rank 2 — splitting the three tied 20s
  // by arrival order. Instead reject only the strictly-lower 10; all three 20s stay.
  assert.equal(tieSafeBottomCount([10, 20, 20, 20, 30], 2), 1);
});

test("an all-tied cohort rejects nobody — you can't single out identical candidates", () => {
  assert.equal(tieSafeBottomCount([20, 20, 20, 20], 2), 0);
  assert.equal(tieSafeBottomCount([20, 20, 20], 1), 0);
});

test("a tie sitting ENTIRELY inside the reject window is still fully rejected", () => {
  // Cutoff between rank 2 (10) and rank 3 (40) does not split a tie, so all three
  // tied 10s — already wholly below the cutoff — are rejected.
  assert.equal(tieSafeBottomCount([10, 10, 10, 40], 3), 3);
});

test("only the straddling tie is spared — strictly-lower candidates still reject", () => {
  // bottom 2 over [5,10,10,30]: cutoff between rank 1 (10) and rank 2 (10) splits
  // the tied 10s → shrink to reject only rank 0 (the 5). The 30 was never at risk.
  assert.equal(tieSafeBottomCount([5, 10, 10, 30], 2), 1);
});

test("a 0 or full-cohort bottom count has no interior boundary to split", () => {
  assert.equal(tieSafeBottomCount([10, 20, 20], 0), 0);
  assert.equal(tieSafeBottomCount([20, 20, 20], 3), 3);
  assert.equal(tieSafeBottomCount([], 0), 0);
});

test("composes with screenBottomCount: default 20% over a tied small cohort", () => {
  // screenBottomCount(5, 20) = 1; with all five tied the tie-break keeps everyone
  // rather than auto-rejecting one of five indistinguishable candidates.
  const scores = [30, 30, 30, 30, 30];
  assert.equal(tieSafeBottomCount(scores, screenBottomCount(scores.length, 20)), 0);
});

// --- per-run override at the screen-wave trust boundary (idea-1852b219). The
// override is a PARTIAL rule merged over the saved config inside runScreenWave;
// validate present fields, clamp present numbers, reject malformed input. ---

test("an absent override (undefined/null) is the no-op empty override", () => {
  for (const empty of [undefined, null]) {
    const result = validateScreeningOverride(empty);
    assert.ok(result.ok);
    assert.deepEqual(result.override, {});
  }
});

test("accepts a partial override and returns only the present known fields", () => {
  const result = validateScreeningOverride({ maxMatchToReject: 60 });
  assert.ok(result.ok);
  assert.deepEqual(result.override, { maxMatchToReject: 60 });
});

test("accepts the simulation's full override unchanged (in-range clamps are idempotent)", () => {
  const result = validateScreeningOverride({ autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 60 });
  assert.ok(result.ok);
  assert.deepEqual(result.override, { autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 60 });
});

test("the catastrophe case: a 100/100 override is CLAMPED, not rejected, but never exceeds 100", () => {
  // rejectBottomPercent 100 + maxMatchToReject 100 is the mass-reject-everyone
  // payload from the requirement. Clamping keeps it at 100 (the documented
  // ceiling) instead of letting 9999 etc. through — the bottom-% math is bounded.
  const result = validateScreeningOverride({ autoRejectEnabled: true, rejectBottomPercent: 9999, maxMatchToReject: 250 });
  assert.ok(result.ok);
  assert.deepEqual(result.override, { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 100 });
});

test("clamps out-of-range override numbers to 0–100", () => {
  const result = validateScreeningOverride({ rejectBottomPercent: -5 });
  assert.ok(result.ok);
  assert.equal(result.override.rejectBottomPercent, 0);
});

test("rejects a non-object override (array, string, number) rather than treating it as empty", () => {
  for (const bad of [[], "screening", 42, true]) {
    const result = validateScreeningOverride(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("rejects a stray/unknown override field", () => {
  const result = validateScreeningOverride({ rejectTopPercent: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /rejectTopPercent/.test(result.error));
});

test("rejects a wrong-typed override value", () => {
  const result = validateScreeningOverride({ rejectBottomPercent: "20" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /rejectBottomPercent/.test(result.error));
});

test("rejects a non-boolean autoRejectEnabled override", () => {
  const result = validateScreeningOverride({ autoRejectEnabled: "yes" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && /autoRejectEnabled/.test(result.error));
});

test("rejects NaN / Infinity in an override number field", () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    const result = validateScreeningOverride({ maxMatchToReject: v });
    assert.equal(result.ok, false, `${v} should be rejected`);
  }
});
