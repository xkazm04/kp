// candidate-profile-job-matching #3(a): when a fresh /api/match run files a
// candidate, Results.tsx writes the fresh recompute (m.total) back as the pipeline
// snapshot so it stops diverging from the never-updated stored score. The write
// must stay null-honest (match-score.ts): a real finite total is persisted, a
// non-finite/absent one becomes null — NEVER a fabricated decision-feeding 0.
//
// Results.tsx is a .tsx (node --test can't load JSX), so the pure write-back rule
// is extracted into MatchTypes.ts and pinned here directly.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchScoreForPipeline } from "./MatchTypes.ts";

test("a real finite total is written back verbatim — including a genuine 0", () => {
  assert.equal(matchScoreForPipeline(57), 57);
  assert.equal(matchScoreForPipeline(0), 0, "a genuine 0 IS a measurement");
  assert.equal(matchScoreForPipeline(100), 100);
});

test("a non-finite or absent total is stored as null, never coerced to 0", () => {
  assert.equal(matchScoreForPipeline(null), null);
  assert.equal(matchScoreForPipeline(undefined), null);
  assert.equal(matchScoreForPipeline(Number.NaN), null);
  assert.equal(matchScoreForPipeline(Number.POSITIVE_INFINITY), null);
});
