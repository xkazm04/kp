// The calm document's pure half (Letter / Outcome / ScoreList, Gate 2).
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeClass, scoreBarClass, scorePct } from "./doc.ts";

test("an outcome is the quiet plane unless it is the accepted (ok) one", () => {
  assert.equal(outcomeClass(), "k-result");
  assert.equal(outcomeClass("default"), "k-result");
  assert.equal(outcomeClass("ok"), "k-result k-result--ok");
});

test("a score bar is clamped to 0..100 and a non-number draws nothing", () => {
  assert.equal(scorePct(72.4), 72.4);
  assert.equal(scorePct(-5), 0);
  assert.equal(scorePct(140), 100);
  assert.equal(scorePct(Number.NaN), 0);
});

test("a zero score keeps its baseline tick (an empty bar is low, not missing)", () => {
  assert.equal(scoreBarClass(0), "k-scores__bar is-zero");
  assert.equal(scoreBarClass(-1), "k-scores__bar is-zero");
  assert.equal(scoreBarClass(1), "k-scores__bar");
});
