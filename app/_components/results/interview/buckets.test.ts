// Pins the off-taxonomy interview-bucket grouping (idea-90b9b3c2).
//
// interviewKit.questions[].bucket is an unconstrained z.string() (LLM output).
// Before this fix, InterviewTab counted/filtered three hardcoded buckets, so a
// question with any other bucket ("situational", a "behavioural" typo) was in
// the "All" count yet shown in no tile and hidden by every filter chip. These
// tests lock the contract that fixes it: unknown buckets fold into one "Other"
// group, only present groups are surfaced (known first, "Other" last), and the
// per-group counts always sum to the total so nothing can disappear.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBucket, groupBuckets, KNOWN_BUCKETS, OTHER_BUCKET } from "./buckets.ts";

const q = (bucket: string) => ({ bucket });

test("classifyBucket keeps known buckets and folds everything else into Other", () => {
  for (const known of KNOWN_BUCKETS) {
    assert.equal(classifyBucket(known), known);
  }
  assert.equal(classifyBucket("situational"), OTHER_BUCKET); // off-taxonomy value
  assert.equal(classifyBucket("behavioural"), OTHER_BUCKET); // typo of "behavioral"
  assert.equal(classifyBucket("Behavioral"), OTHER_BUCKET); // case-sensitive: not the known key
  assert.equal(classifyBucket(""), OTHER_BUCKET); // empty string
});

test("groupBuckets surfaces only present groups, known first then Other", () => {
  const groups = groupBuckets([
    q("technical"),
    q("behavioral"),
    q("situational"),
    q("behavioral")
  ]);
  // "red-flag-defense" is absent so it is not surfaced; "Other" comes last.
  assert.deepEqual(groups, [
    { key: "behavioral", count: 2 },
    { key: "technical", count: 1 },
    { key: OTHER_BUCKET, count: 1 }
  ]);
});

test("groupBuckets omits the Other group entirely when every bucket is known", () => {
  const groups = groupBuckets([q("behavioral"), q("red-flag-defense")]);
  assert.deepEqual(
    groups.map((group) => group.key),
    ["behavioral", "red-flag-defense"]
  );
  assert.equal(
    groups.some((group) => group.key === OTHER_BUCKET),
    false
  );
});

test("group counts always sum to the total so no question can disappear", () => {
  const questions = [
    q("behavioral"),
    q("technical"),
    q("red-flag-defense"),
    q("situational"),
    q("behavioural"),
    q("")
  ];
  const total = groupBuckets(questions).reduce((sum, group) => sum + group.count, 0);
  assert.equal(total, questions.length);
});

test("groupBuckets returns no groups for an empty question list", () => {
  assert.deepEqual(groupBuckets([]), []);
});
