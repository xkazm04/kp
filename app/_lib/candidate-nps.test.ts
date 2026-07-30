import { test } from "node:test";
import assert from "node:assert/strict";
import { NPS_COMMENT_MAX, NPS_MIN_SAMPLE, npsBucket, parseNpsSubmission, summarizeNps } from "./candidate-nps.ts";

test("buckets follow the standard NPS bands", () => {
  assert.equal(npsBucket(10), "promoter");
  assert.equal(npsBucket(9), "promoter");
  assert.equal(npsBucket(8), "passive");
  assert.equal(npsBucket(7), "passive");
  assert.equal(npsBucket(6), "detractor");
  assert.equal(npsBucket(0), "detractor");
});

test("a submission is validated, never coerced", () => {
  // A coerced 0 is a detractor the candidate never chose — the reason this rejects
  // instead of clamping.
  assert.deepEqual(parseNpsSubmission({ score: 9 }), { ok: true, score: 9, comment: null });
  assert.equal(parseNpsSubmission({ score: "not a number" }).ok, false);
  assert.equal(parseNpsSubmission({}).ok, false);
  assert.equal(parseNpsSubmission({ score: null }).ok, false);
  assert.equal(parseNpsSubmission({ score: 11 }).ok, false);
  assert.equal(parseNpsSubmission({ score: -1 }).ok, false);
  assert.equal(parseNpsSubmission({ score: 7.5 }).ok, false);
});

test("a numeric string is accepted but a blank one is not", () => {
  assert.deepEqual(parseNpsSubmission({ score: "8" }), { ok: true, score: 8, comment: null });
  assert.equal(parseNpsSubmission({ score: "" }).ok, false, "Number('') is 0 — that must not become a detractor");
  assert.equal(parseNpsSubmission({ score: "  " }).ok, false);
});

test("comments are trimmed, capped, and empty means null", () => {
  const blank = parseNpsSubmission({ score: 5, comment: "   " });
  assert.ok(blank.ok && blank.comment === null);
  const long = parseNpsSubmission({ score: 5, comment: "x".repeat(2000) });
  assert.ok(long.ok && long.comment!.length === NPS_COMMENT_MAX);
  const trimmed = parseNpsSubmission({ score: 5, comment: "  good process  " });
  assert.ok(trimmed.ok && trimmed.comment === "good process");
});

test("the score is WITHHELD below the sample floor", () => {
  // Unlike a duration, an NPS is a difference of proportions: it reads as authoritative
  // at any sample size, so a caveat is not enough — the number is not published.
  const few = summarizeNps([10, 10, 9]);
  assert.equal(few.responses, 3);
  assert.equal(few.score, null);
  assert.equal(few.belowSampleFloor, true);
  assert.equal(few.mean, 9.7, "the mean is still reported — it does not overstate the way a +100 would");
});

test("at the floor the score is published and correct", () => {
  const scores = [10, 10, 10, 10, 10, 10, 9, 0, 0, 5]; // 7 promoters, 0 passives, 3 detractors
  assert.equal(scores.length, NPS_MIN_SAMPLE);
  const s = summarizeNps(scores);
  assert.equal(s.belowSampleFloor, false);
  assert.equal(s.promoters, 7);
  assert.equal(s.detractors, 3);
  assert.equal(s.passives, 0);
  assert.equal(s.score, 40); // (7-3)/10 * 100
});

test("no responses is empty, not zero", () => {
  const s = summarizeNps([]);
  assert.equal(s.responses, 0);
  assert.equal(s.score, null);
  assert.equal(s.mean, null, "a mean of 0 would read as universally terrible rather than unmeasured");
});

test("out-of-range rows in storage are ignored rather than skewing the fold", () => {
  const s = summarizeNps([10, 99, -5, 9, Number.NaN]);
  assert.equal(s.responses, 2);
  assert.equal(s.promoters, 2);
});
