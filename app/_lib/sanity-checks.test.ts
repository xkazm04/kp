import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSanityChecks, countSanityWarns, isSanityWarn } from "./sanity-checks.ts";

// One representative string per engine emitter (pipeline.py), so a renamed or
// new warn shape that the classifier misses shows up as a test to update —
// keeping the classifier and the engine's vocabulary in lockstep.
const ENGINE_WARNS = [
  "Profile text is short",
  "Score outside expected range",
  "Score total (95) disagrees with its breakdown (components sum to 40, off by 55) — verify the score before trusting it",
  "Archetype routing is low-confidence — Experienced hire at 35% (no detection signals fired); verify the candidate's archetype before trusting the score",
  "Salary range is inconsistent",
  "Salary range needs manual review",
  "Profile text was short — assessment may be less reliable (manual review)",
  "Score section missing — defaulted to 0 (manual review)",
  "Salary range was reversed — corrected (manual review)",
  "Interview kit unavailable — insight skipped (manual review)",
];

const ENGINE_OKS = [
  "Profile text length OK",
  "Score is inside 0-100",
  "Score total matches its breakdown",
  "Archetype routing OK — Experienced hire at 82% confidence",
  "Salary range order OK",
  "Salary range seems plausible",
  "No salary estimate produced",
];

test("every engine warn shape classifies as a warn", () => {
  for (const check of ENGINE_WARNS) assert.equal(isSanityWarn(check), true, check);
});

test("every engine ok/neutral shape classifies as ok", () => {
  for (const check of ENGINE_OKS) assert.equal(isSanityWarn(check), false, check);
});

test("splitSanityChecks partitions and preserves order", () => {
  const { warns, oks } = splitSanityChecks([ENGINE_OKS[0], ENGINE_WARNS[0], ENGINE_OKS[1], ENGINE_WARNS[1]]);
  assert.deepEqual(warns, [ENGINE_WARNS[0], ENGINE_WARNS[1]]);
  assert.deepEqual(oks, [ENGINE_OKS[0], ENGINE_OKS[1]]);
});

test("countSanityWarns matches the split", () => {
  const mixed = [...ENGINE_OKS, ...ENGINE_WARNS];
  assert.equal(countSanityWarns(mixed), ENGINE_WARNS.length);
  assert.equal(countSanityWarns(ENGINE_OKS), 0);
  assert.equal(countSanityWarns([]), 0);
});
