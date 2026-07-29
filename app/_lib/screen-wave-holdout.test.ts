// Pins the calibration-holdout selector (UAT 2026-07-20, KAT-L1-001/002).
//
// The holdout is the clean arm that makes selection quality falsifiable at all:
// calibration currently pairs the match score against an outcome label the score
// ITSELF produces (the wave rejects on the score; `rejected` is the negative
// label), so the predictor causes its own label and a perfectly biased screener
// would still draw a near-perfect reliability curve.
//
// The selector's hard requirement is DETERMINISM. The wave signs the exact reject
// set into an approval token at preview time and re-derives it at commit; if
// holdout membership were re-rolled per call, preview and commit would disagree
// and every commit would 409. It must also be stable against threshold fiddling,
// or a recruiter could nudge the slider until a specific person stopped being
// spared.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { isHoldout, selectHoldout } from "./screen-wave-holdout.ts";

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `entry-${i}`);

test("is deterministic — the same (job, entry) always lands the same way", () => {
  const first = isHoldout("job-1", "entry-7", 5);
  for (let i = 0; i < 50; i++) {
    assert.equal(isHoldout("job-1", "entry-7", 5), first);
  }
});

test("does not depend on the threshold — a recruiter cannot re-roll it", () => {
  // The policy version / threshold is deliberately NOT part of the key: otherwise
  // nudging maxMatchToReject would reshuffle who is spared, which is a gaming vector
  // AND would break the preview→commit token match.
  const spared = ids(200).filter((id) => isHoldout("job-1", id, 10));
  const again = ids(200).filter((id) => isHoldout("job-1", id, 10));
  assert.deepEqual(spared, again);
});

test("membership is per-role — the same candidate can differ across jobs", () => {
  const a = ids(300).filter((id) => isHoldout("job-A", id, 10));
  const b = ids(300).filter((id) => isHoldout("job-B", id, 10));
  assert.notDeepEqual(a, b, "holdout must be keyed on the role too, not the candidate alone");
});

test("0 percent spares nobody — the feature is fully disableable", () => {
  assert.equal(ids(500).filter((id) => isHoldout("job-1", id, 0)).length, 0);
});

test("100 percent spares everybody", () => {
  assert.equal(ids(100).filter((id) => isHoldout("job-1", id, 100)).length, 100);
});

test("a negative or non-finite percent is treated as disabled, never as a crash", () => {
  assert.equal(isHoldout("job-1", "entry-1", -5), false);
  assert.equal(isHoldout("job-1", "entry-1", Number.NaN), false);
});

test("the sampled rate is close to the requested rate over a realistic cohort", () => {
  // Not a uniformity proof — a sanity bound. At 10% over 2000 entries a sane hash
  // lands well inside 5–16%; a broken one (all-or-nothing, or keyed on nothing)
  // shows up immediately outside it.
  const rate = ids(2000).filter((id) => isHoldout("job-1", id, 10)).length / 2000;
  assert.ok(rate > 0.05 && rate < 0.16, `expected ~10% holdout, got ${(rate * 100).toFixed(1)}%`);
});

test("selectHoldout partitions a reject set without losing or duplicating anyone", () => {
  const rejectIds = ids(120);
  const { spared, rejected } = selectHoldout("job-1", rejectIds, 10);
  assert.equal(spared.length + rejected.length, rejectIds.length);
  assert.deepEqual([...spared, ...rejected].sort(), [...rejectIds].sort());
  assert.equal(new Set([...spared, ...rejected]).size, rejectIds.length);
});

test("selectHoldout at 0 percent is a pure pass-through", () => {
  const rejectIds = ids(30);
  const { spared, rejected } = selectHoldout("job-1", rejectIds, 0);
  assert.deepEqual(spared, []);
  assert.deepEqual(rejected, rejectIds);
});

test("selectHoldout preserves input order in both partitions", () => {
  // The wave reports rows in rank order; a reordering here would scramble the
  // preview the human approves.
  const rejectIds = ids(200);
  const { spared, rejected } = selectHoldout("job-1", rejectIds, 25);
  assert.deepEqual(spared, rejectIds.filter((id) => spared.includes(id)));
  assert.deepEqual(rejected, rejectIds.filter((id) => rejected.includes(id)));
});

test("an empty reject set is safe", () => {
  const { spared, rejected } = selectHoldout("job-1", [], 5);
  assert.deepEqual(spared, []);
  assert.deepEqual(rejected, []);
});
