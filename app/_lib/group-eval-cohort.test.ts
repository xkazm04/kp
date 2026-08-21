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
import { GROUP_EVAL_MIN_COHORT, fairnessCoversCohort, hasComparableCohort } from "./group-eval-cohort.ts";
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

// ---- The robustness COVERAGE gate (scan-sweep) -----------------------------
//
// `robustness: "assessed"` claims "the cross-scheme re-scoring genuinely tested the
// order" and is persisted, rendered AND sealed into the decision record. It was derived
// from assessRobustness(hasJob, fairness) alone, which only proves the matrix is
// internally ALIGNED — never that it covers the field that was compared. The recruiter
// pool drops every candidate group-eval-run cannot resolve (no candidateId, or a
// candidateId whose profile and analysis are both gone), yet those candidates are still
// compared and still ranked on their stored matchScore — so a 2x2 matrix could seal
// "assessed" over a three-way comparison whose LEAD it never scored.
//
// NON-VACUITY: the pre-fix run had no coverage test at all, so the third assertion
// below (a compared candidate missing from the matrix ⇒ not covered) is exactly the
// case that used to seal "assessed"; the first two pin that a fully-covered field and
// order-independence are unaffected.
test("fairnessCoversCohort: covered only when EVERY compared candidate is in the matrix", () => {
  const matrix = { candidateIds: ["c1", "c2", "c3"] };
  assert.equal(fairnessCoversCohort(["c1", "c2", "c3"], matrix), true);
  assert.equal(fairnessCoversCohort(["c3", "c1", "c2"], matrix), true, "coverage is a set question, not an order one");
  // The reported defect: the ranker never scored c9, but c9 was compared (and could be
  // crowned on its stored matchScore).
  assert.equal(fairnessCoversCohort(["c1", "c9"], matrix), false);
  // A candidate with NO candidateId can never be in the matrix — pool entries are keyed
  // on it — so a field containing one is never fully covered.
  assert.equal(fairnessCoversCohort(["c1", null], matrix), false);
  assert.equal(fairnessCoversCohort(["c1", undefined], matrix), false);
});

test("fairnessCoversCohort: a missing/empty/malformed matrix covers nothing", () => {
  assert.equal(fairnessCoversCohort(["c1"], null), false, "a ranker failure is not coverage");
  assert.equal(fairnessCoversCohort(["c1"], undefined), false);
  assert.equal(fairnessCoversCohort(["c1"], {}), false, "a legacy blob with no candidateIds is not coverage");
  assert.equal(fairnessCoversCohort(["c1"], { candidateIds: [] }), false);
  assert.equal(fairnessCoversCohort(["c1"], { candidateIds: "c1" }), false, "candidateIds must be an array");
  assert.equal(fairnessCoversCohort([], { candidateIds: ["c1"] }), false, "an empty compared field is not a covered one");
});
