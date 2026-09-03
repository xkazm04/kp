// The two lockstep rules of the cross-scheme fairness matrix, pinned as pure
// functions. Both used to live inline in jobsRecruiterCandidatesLogic.ts — a
// client hook, so nothing could reach them without a DOM, and the ONE surface
// whose whole purpose is to be bias-defensible had zero tests over its
// arithmetic. The rules:
//
//   1. The index gate spans EVERY parallel array (`candidateIds`, `own`, `mean`).
//      A short `own` must degrade to "not assessed" (an empty map), never
//      fabricate `own = 0` and hand a candidate a full-mean advantage.
//   2. The CSV writes a delta only when BOTH sides of it are numbers. A missing
//      own-score prints "", never `mean - 0`; a row missing both prints "",
//      never a flat 0 that reads as "perfectly robust".
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexFairnessMatrix, fairnessCsvRows } from "./jobsFairnessMatrix.ts";
import type { FairnessMatrix } from "./JobsTypes.ts";

function matrix(over: Partial<FairnessMatrix> = {}): FairnessMatrix {
  return {
    labels: ["Ada", "Grace", "Alan"],
    candidateIds: ["c1", "c2", "c3"],
    matrix: [
      [80, 70, 60],
      [75, 85, 65],
      [60, 62, 70],
    ],
    own: [80, 85, 70],
    mean: [70, 75, 64],
    ...over,
  };
}

test("indexFairnessMatrix indexes own/mean/delta by candidate id", () => {
  const idx = indexFairnessMatrix(matrix());
  assert.equal(idx.size, 3);
  assert.deepEqual(idx.get("c2"), { own: 85, mean: 75, delta: -10 });
  assert.deepEqual(idx.get("c3"), { own: 70, mean: 64, delta: -6 });
});

test("indexFairnessMatrix returns an empty map when the arrays are not in lockstep", () => {
  // A short `own` is the case that fabricated a full-mean advantage.
  assert.equal(indexFairnessMatrix(matrix({ own: [80, 85] })).size, 0);
  assert.equal(indexFairnessMatrix(matrix({ mean: [70] })).size, 0);
  assert.equal(indexFairnessMatrix(matrix({ candidateIds: undefined })).size, 0);
  assert.equal(indexFairnessMatrix(null).size, 0);
  // A non-array own (a mangled JSON blob) is not silently indexed either.
  assert.equal(indexFairnessMatrix(matrix({ own: undefined as unknown as number[] })).size, 0);
});

test("fairnessCsvRows writes a delta only when both sides are known", () => {
  const rows = fairnessCsvRows(matrix());
  assert.deepEqual(rows[0], ["Ada", 80, 70, -10, 80, 70, 60]);

  const short = fairnessCsvRows(matrix({ own: [80] }));
  assert.deepEqual(short[1], ["Grace", "", 75, "", 75, 85, 65]);
  assert.deepEqual(short[2], ["Alan", "", 64, "", 60, 62, 70]);
});

test("fairnessCsvRows tolerates a missing matrix row without inventing cells", () => {
  const rows = fairnessCsvRows(matrix({ matrix: [[80, 70, 60]] }));
  assert.deepEqual(rows[1], ["Grace", 85, 75, -10]);
});

test("fairnessCsvRows on a null matrix is empty", () => {
  assert.deepEqual(fairnessCsvRows(null), []);
});
