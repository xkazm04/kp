import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAuthenticity } from "./devcase-authenticity.ts";

const base = {
  commitCount: 12,
  bursty: false,
  spanHours: 30,
  decisionsLogPresent: true,
  readBeforeWrite: 0.6,
  iterationPattern: "linear",
};

test("a clean incremental submission scores authentic", () => {
  const a = scoreAuthenticity(base);
  assert.equal(a.score, 100);
  assert.equal(a.band, "authentic");
  assert.deepEqual(a.reasons, []);
});

test("single bulk commit + no decisions log + bursty reads as suspect", () => {
  const a = scoreAuthenticity({
    ...base,
    commitCount: 1,
    decisionsLogPresent: false,
    bursty: true,
    iterationPattern: "big-bang",
    readBeforeWrite: 0.2,
  });
  // 100 -40 -25 -15 -15 -15 = clamped to 0
  assert.equal(a.score, 0);
  assert.equal(a.band, "suspect");
  assert.ok(a.reasons.length >= 4);
});

test("a single missing signal lands in the mixed band", () => {
  const a = scoreAuthenticity({ ...base, decisionsLogPresent: false });
  assert.equal(a.score, 75);
  assert.equal(a.band, "authentic"); // 75 >= 70
  const b = scoreAuthenticity({ ...base, commitCount: 1 });
  assert.equal(b.score, 60);
  assert.equal(b.band, "mixed"); // 60 in [40,70)
});

test("no readable history is penalized but not as a single bulk commit", () => {
  const a = scoreAuthenticity({ ...base, commitCount: 0 });
  assert.equal(a.score, 85); // -15, not -40
  assert.match(a.reasons[0], /No readable commit history/);
});

test("absent reflection fields don't penalize (older bundles / fallback)", () => {
  const a = scoreAuthenticity({
    commitCount: 8,
    bursty: false,
    spanHours: null,
    decisionsLogPresent: true,
    readBeforeWrite: null,
    iterationPattern: null,
  });
  assert.equal(a.score, 100);
  assert.equal(a.band, "authentic");
});

test("score never leaves 0..100", () => {
  const a = scoreAuthenticity({ commitCount: 1, bursty: true, spanHours: 1, decisionsLogPresent: false, readBeforeWrite: 0, iterationPattern: "big-bang" });
  assert.ok(a.score >= 0 && a.score <= 100);
});
