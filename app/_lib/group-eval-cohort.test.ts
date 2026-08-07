// bug-ui-scan-2026-07-09 #4: a group evaluation must not make a COMPARATIVE claim from a
// field of one — no "recommended lead over the field", no "unique strengths", no robust
// cross-scheme ranking. This pins the pure min-cohort gate + the differentiators no-rival
// floor (the DB-driven end-to-end proof — no lead sealed, robustness "insufficient_sample"
// — lives in group-eval-cohort-run.test.ts).
//
// NON-VACUITY: pre-fix, computeDifferentiators returned EVERY requirement skill the lead
// matched when `rivals` was empty (the empty rivalMatched set makes every skill pass
// `!rivalMatched.has(skill)`), so `computeDifferentiators(lead, [], reqs)` yielded
// ["ts","react"], not []. The no-rival assertion below fails against that. Run: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_EVAL_MIN_COHORT, hasComparableCohort } from "./group-eval-cohort.ts";
import { computeDifferentiators } from "./group-eval-differentiators.ts";

test("the min-cohort floor is 2 (a head-to-head comparison needs >1 to compare)", () => {
  assert.equal(GROUP_EVAL_MIN_COHORT, 2);
});

test("hasComparableCohort gates below the floor", () => {
  assert.equal(hasComparableCohort(0), false);
  assert.equal(hasComparableCohort(1), false, "a single candidate is NOT a comparable field");
  assert.equal(hasComparableCohort(2), true);
  assert.equal(hasComparableCohort(6), true);
});

test("computeDifferentiators returns [] with no rivals (was: ALL of the lead's skills)", () => {
  const lead = { matchedSkills: ["ts", "react"] };
  const reqs = [
    { skill: "ts", kind: "must_have" },
    { skill: "react", kind: "nice_to_have" },
  ];
  // The reported bug: with no rivals every matched requirement skill is trivially
  // "unique". The floor makes it empty — there is nothing to be unique AGAINST.
  assert.deepEqual(computeDifferentiators(lead, [], reqs), []);
  // Sanity: with a real rival the genuine exclusive edge is still computed.
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: ["react"] }], reqs), ["ts"]);
});
