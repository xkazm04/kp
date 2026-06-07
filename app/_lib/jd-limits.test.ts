// Pins the AI JD builder's minimum-need contract (idea-81e2e0bf). The thresholds
// used to live only in JdBuilder's `canGenerate` as bare magic numbers
// (`title.trim().length > 1 && needText.trim().length > 10`); validateJdBuildInput
// is now the single source the form gate AND the runJdBuild boundary share, so a
// deep-link/simulation prefill or a programmatic startTask can't slip a near-empty
// need into the 1–2 minute AI chain. These tests fix the boundary so a refactor
// can't silently loosen or drift it.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JD_BUILD_NEED_MIN_LENGTH,
  JD_BUILD_TITLE_MIN_LENGTH,
  validateJdBuildInput,
} from "./jd-limits.ts";

test("the named minimums match the historical client-only thresholds", () => {
  // The old gate was `> 1` / `> 10`; the inclusive minimums must be one higher so
  // behavior is byte-identical at the boundary.
  assert.equal(JD_BUILD_TITLE_MIN_LENGTH, 2);
  assert.equal(JD_BUILD_NEED_MIN_LENGTH, 11);
});

test("accepts a real title + a described need, returning trimmed fields", () => {
  const r = validateJdBuildInput("  Staff Engineer  ", "  Owns the payments platform end to end.  ");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.title, "Staff Engineer");
    assert.equal(r.needText, "Owns the payments platform end to end.");
  }
});

test("rejects a title shorter than the minimum (matches the old `> 1`)", () => {
  // length 1 was rejected by `> 1`; length 2 was accepted.
  assert.equal(validateJdBuildInput("E", "a need long enough to pass").ok, false);
  assert.equal(validateJdBuildInput("En", "a need long enough to pass").ok, true);
  // Whitespace doesn't count toward the minimum.
  assert.equal(validateJdBuildInput("  E  ", "a need long enough to pass").ok, false);
});

test("rejects a need shorter than the minimum (matches the old `> 10`)", () => {
  // 10 chars was rejected by `> 10`; 11 chars was accepted.
  assert.equal(validateJdBuildInput("Engineer", "0123456789").ok, false);
  assert.equal(validateJdBuildInput("Engineer", "01234567890").ok, true);
  // Whitespace-padded short need still fails.
  assert.equal(validateJdBuildInput("Engineer", "   short   ").ok, false);
});

test("non-string / missing params fail closed rather than throwing", () => {
  assert.equal(validateJdBuildInput(undefined, undefined).ok, false);
  assert.equal(validateJdBuildInput(null, 42).ok, false);
  assert.equal(validateJdBuildInput("Engineer", undefined).ok, false);
});

test("each failure carries a distinct, user-facing message", () => {
  const badTitle = validateJdBuildInput("E", "a need long enough to pass");
  const badNeed = validateJdBuildInput("Engineer", "too short");
  assert.equal(badTitle.ok, false);
  assert.equal(badNeed.ok, false);
  if (!badTitle.ok && !badNeed.ok) {
    assert.match(badTitle.error, /title/i);
    assert.match(badNeed.error, /need/i);
    assert.notEqual(badTitle.error, badNeed.error);
  }
});
