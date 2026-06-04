// Pins the TS half of the advance/hold/reject verdict contract (idea-d00da358).
//
// The canonical set + fallback + validators live in interview-recommendation.ts
// and are mirrored on the Python side (pipeline/jobfit/automation.py:
// RECOMMENDATIONS / RECOMMENDATION_FALLBACK / coerce_recommendation), pinned
// independently by test_automation.py. This test asserts the TS contract: the
// legal set, the `hold` fallback for anything off-set, and that the validators
// normalize case/whitespace and never leak an off-taxonomy value.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_RECOMMENDATION_FALLBACK,
  SCREEN_ROUTES,
  isInterviewRecommendation,
  coerceInterviewRecommendation,
  coerceScreenRoute,
} from "./interview-recommendation.ts";

test("the canonical set is exactly advance|hold|reject, in order", () => {
  assert.deepEqual([...INTERVIEW_RECOMMENDATIONS], ["advance", "hold", "reject"]);
});

test("the documented fallback is `hold` and is itself a legal verdict", () => {
  assert.equal(INTERVIEW_RECOMMENDATION_FALLBACK, "hold");
  assert.ok(INTERVIEW_RECOMMENDATIONS.includes(INTERVIEW_RECOMMENDATION_FALLBACK));
});

test("the screen route is the {advance, hold} subset of the verdicts", () => {
  assert.deepEqual([...SCREEN_ROUTES], ["advance", "hold"]);
  for (const r of SCREEN_ROUTES) assert.ok(INTERVIEW_RECOMMENDATIONS.includes(r));
});

test("isInterviewRecommendation accepts members case/whitespace-insensitively", () => {
  for (const v of INTERVIEW_RECOMMENDATIONS) {
    assert.ok(isInterviewRecommendation(v));
    assert.ok(isInterviewRecommendation(` ${v.toUpperCase()} `));
  }
});

test("isInterviewRecommendation rejects unknown / empty / non-string values", () => {
  for (const v of ["advanced", "skip", "", "  ", null, undefined, 1, {}]) {
    assert.equal(isInterviewRecommendation(v), false, `${JSON.stringify(v)} must not be a recommendation`);
  }
});

test("coerceInterviewRecommendation normalizes recognised verdicts", () => {
  assert.equal(coerceInterviewRecommendation("Advance"), "advance");
  assert.equal(coerceInterviewRecommendation(" HOLD "), "hold");
  assert.equal(coerceInterviewRecommendation("reject"), "reject");
});

test("coerceInterviewRecommendation falls back to `hold` for anything off-set", () => {
  for (const v of ["advanced", "yes", "", null, undefined, 42, {}]) {
    assert.equal(coerceInterviewRecommendation(v), "hold", `${JSON.stringify(v)} should fall back to hold`);
  }
});

test("coerceScreenRoute keeps advance/hold and holds for anything else", () => {
  assert.equal(coerceScreenRoute("advance"), "advance");
  assert.equal(coerceScreenRoute(" Advance "), "advance");
  assert.equal(coerceScreenRoute("hold"), "hold");
  // `reject` is a legal verdict but NOT a route — it must hold, never auto-advance.
  for (const v of ["reject", "advanced", "", null, undefined]) {
    assert.equal(coerceScreenRoute(v), "hold", `route ${JSON.stringify(v)} should hold`);
  }
});
