// Pins the task dedupe-key contract (idea-5e38b9ad): a missing/empty identifying
// param must never collapse a key to a constant that merges unrelated runs.
// startTask reuses an in-flight task ONLY when buildDedupeKey returns a non-null
// (stable) key; a null result forces a guaranteed-unique key.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDedupeKey, stableKey } from "./task-dedupe.ts";

test("stableKey joins present, non-empty parts with the prefix", () => {
  assert.equal(stableKey("analyze", "abc"), "analyze:abc");
  assert.equal(stableKey("automation", "e1", "screen"), "automation:e1:screen");
  assert.equal(stableKey("k", 0), "k:0", "0 is a valid, present value");
  assert.equal(stableKey("k", false), "k:false");
});

test("stableKey returns null when any required part is missing or blank", () => {
  assert.equal(stableKey("analyze", undefined), null);
  assert.equal(stableKey("analyze", null), null);
  assert.equal(stableKey("analyze", ""), null);
  assert.equal(stableKey("analyze", "   "), null, "whitespace-only is treated as empty");
  assert.equal(stableKey("reasoning", "who", undefined), null, "one missing part fails the whole key");
});

test("analyze: a missing baseDir does NOT collapse to a constant", () => {
  assert.equal(buildDedupeKey("analyze", { baseDir: "/uploads/u1" }), "analyze:/uploads/u1");
  // The bug: `analyze:${undefined}` => "analyze:undefined" matched every other
  // baseDir-less analyze. Now it yields null => startTask uses a unique key.
  assert.equal(buildDedupeKey("analyze", {}), null);
  assert.equal(buildDedupeKey("analyze", { baseDir: "" }), null);
});

test("group_eval / lifecycle / interview_prep / evaluate_submission reject missing identity", () => {
  assert.equal(buildDedupeKey("group_eval", { roleKey: "backend" }), "group_eval:backend");
  assert.equal(buildDedupeKey("group_eval", {}), null);
  assert.equal(buildDedupeKey("lifecycle", { lifecycleId: "lc1" }), "lifecycle:lc1");
  assert.equal(buildDedupeKey("lifecycle", {}), null);
  assert.equal(buildDedupeKey("interview_prep", { entryId: "pe1" }), "interview_prep:pe1");
  assert.equal(buildDedupeKey("interview_prep", {}), null);
  assert.equal(buildDedupeKey("evaluate_submission", { submissionId: "s1" }), "evaluate_submission:s1");
  assert.equal(buildDedupeKey("evaluate_submission", {}), null);
});

test("reasoning: any identity source works, all-absent yields null (was 'reasoning::undefined')", () => {
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1" }), "reasoning:p1:j1");
  assert.equal(buildDedupeKey("reasoning", { analysisSlug: "a1", jobId: "j1" }), "reasoning:a1:j1");
  assert.equal(
    buildDedupeKey("reasoning", { candidate: { name: "X" }, jobId: "j1" }),
    `reasoning:${JSON.stringify({ name: "X" })}:j1`
  );
  // profileId wins the fallback chain when several are present.
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1", analysisSlug: "a1", jobId: "j1" }), "reasoning:p1:j1");
  // No candidate identity at all, or no jobId → null, not a shared constant.
  assert.equal(buildDedupeKey("reasoning", { jobId: "j1" }), null);
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1" }), null);
  assert.equal(buildDedupeKey("reasoning", {}), null);
});

test("automation: required entryId+task, optional notes flag appended only after a real key", () => {
  assert.equal(buildDedupeKey("automation", { entryId: "e1", task: "screen" }), "automation:e1:screen:");
  assert.equal(buildDedupeKey("automation", { entryId: "e1", task: "screen", notes: "x" }), "automation:e1:screen:n");
  assert.equal(buildDedupeKey("automation", { task: "screen" }), null, "missing entryId fails");
  assert.equal(buildDedupeKey("automation", { entryId: "e1" }), null, "missing task fails");
});

test("commit_reflection / jd_build keep required identity but allow empty optional discriminators", () => {
  assert.equal(buildDedupeKey("commit_reflection", { repoRef: "r1" }), "commit_reflection:r1:");
  assert.equal(buildDedupeKey("commit_reflection", { repoRef: "r1", caseId: "c1" }), "commit_reflection:r1:c1");
  assert.equal(buildDedupeKey("commit_reflection", {}), null);
  assert.equal(buildDedupeKey("jd_build", { title: "Eng" }), "jd_build:Eng:0:");
  assert.equal(buildDedupeKey("jd_build", { title: "Eng", needText: "hello", repoUrl: "u" }), "jd_build:Eng:5:u");
  assert.equal(buildDedupeKey("jd_build", {}), null);
});

test("need_analysis / design_artifacts require a present need object", () => {
  assert.equal(buildDedupeKey("need_analysis", { need: { title: "t" } }), `need_analysis:${JSON.stringify({ title: "t" })}`);
  assert.equal(buildDedupeKey("need_analysis", {}), null, "absent need no longer collapses to need_analysis:{}");
  const need = { title: "t" };
  assert.equal(
    buildDedupeKey("design_artifacts", { need }),
    `design_artifacts:${JSON.stringify(need)}:${JSON.stringify({})}`
  );
  assert.equal(buildDedupeKey("design_artifacts", { analysis: { x: 1 } }), null, "need is the required identity");
});

test("batch_screen is an intentional singleton constant", () => {
  assert.equal(buildDedupeKey("batch_screen", {}), "batch_screen");
});

test("an unknown kind has no builder and yields null (safe: forces a unique key)", () => {
  assert.equal(buildDedupeKey("does_not_exist", { anything: 1 }), null);
});
