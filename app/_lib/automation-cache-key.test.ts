// Pins the automation prompt-cache keying contract (idea-8dcf7828). The headline
// guarantee: a changed candidate profile MUST change the key, so a re-extracted/
// edited CV invalidates the 168h-cached prep instead of serving byte-identical
// stale questions on Regenerate. Also locks that each keyed field is independent
// and that stage/notes only matter for the tasks that actually use them.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAutomationCacheKey,
  computeCorpusFingerprint,
  type AutomationKeyInput,
} from "./automation-cache-key.ts";

const base: AutomationKeyInput = {
  version: "interview-prep-v1",
  task: "prep",
  candidateId: "cand-1",
  profileJson: JSON.stringify({ name: "Ada", skills: ["python"] }),
  jobId: "job-1",
  stage: "Screened",
  notes: "",
};

test("identical inputs hash identically (an unchanged profile stays a cache HIT)", () => {
  assert.equal(computeAutomationCacheKey({ ...base }), computeAutomationCacheKey({ ...base }));
});

test("THE FIX: a changed profile payload changes the key (Regenerate honors an edited CV)", () => {
  // Same candidate/job/task — only the CV-derived profile content differs, exactly
  // the re-extract/edit case. Pre-fix this returned the same key and served stale prep.
  const edited = computeAutomationCacheKey({
    ...base,
    profileJson: JSON.stringify({ name: "Ada", skills: ["python", "rust"] }),
  });
  assert.notEqual(computeAutomationCacheKey({ ...base }), edited);
});

test("each keyed field independently affects the key", () => {
  const k0 = computeAutomationCacheKey({ ...base });
  assert.notEqual(k0, computeAutomationCacheKey({ ...base, version: "interview-prep-v2" }));
  assert.notEqual(k0, computeAutomationCacheKey({ ...base, candidateId: "cand-2" }));
  assert.notEqual(k0, computeAutomationCacheKey({ ...base, jobId: "job-2" }));
  assert.notEqual(k0, computeAutomationCacheKey({ ...base, jobId: null }));
});

test("rejection task folds stage into the key; other tasks ignore stage", () => {
  // The rejection prompt varies by stage, so the key must too.
  const rej = { ...base, task: "rejection", version: "rejection-v1" };
  assert.notEqual(
    computeAutomationCacheKey(rej),
    computeAutomationCacheKey({ ...rej, stage: "Interviewing" })
  );
  // For a non-rejection task, stage is not part of the prompt → must not split the key.
  assert.equal(
    computeAutomationCacheKey({ ...base }),
    computeAutomationCacheKey({ ...base, stage: "Interviewing" })
  );
});

test("scorecard task folds notes into the key; other tasks ignore notes", () => {
  const sc = { ...base, task: "scorecard", version: "scorecard-v3" };
  assert.notEqual(
    computeAutomationCacheKey(sc),
    computeAutomationCacheKey({ ...sc, notes: "strong system design" })
  );
  // A non-scorecard task never reads notes → they must not split the key.
  assert.equal(
    computeAutomationCacheKey({ ...base }),
    computeAutomationCacheKey({ ...base, notes: "ignored here" })
  );
});

test("THE FIX: rematch folds the corpus fingerprint into the key; other tasks ignore it", () => {
  // rematch scores the ENTIRE live corpus, so a changed set of openings MUST change
  // the key — otherwise a days-old HIT routes the candidate at a since-closed role or
  // keeps missing a newly-opened fit for the full 168h TTL (idea-e01935e9).
  const rm = { ...base, task: "rematch", version: "rematch-v1", corpusFingerprint: "corpus-a" };
  assert.notEqual(
    computeAutomationCacheKey(rm),
    computeAutomationCacheKey({ ...rm, corpusFingerprint: "corpus-b" })
  );
  // A non-rematch task scores a single job, never the corpus → the fingerprint must
  // not split its key (mirrors the stage/notes task-scoping above).
  assert.equal(
    computeAutomationCacheKey({ ...base }),
    computeAutomationCacheKey({ ...base, corpusFingerprint: "corpus-a" })
  );
});

test("computeCorpusFingerprint is order-independent and set-sensitive", () => {
  // The corpus query order must never split the key, but adding/removing an opening must.
  assert.equal(
    computeCorpusFingerprint(["job-3", "job-1", "job-2"]),
    computeCorpusFingerprint(["job-1", "job-2", "job-3"])
  );
  assert.notEqual(
    computeCorpusFingerprint(["job-1", "job-2"]),
    computeCorpusFingerprint(["job-1", "job-2", "job-3"])
  );
  // A removed opening (closed/filled role) changes the fingerprint too.
  assert.notEqual(
    computeCorpusFingerprint(["job-1", "job-2", "job-3"]),
    computeCorpusFingerprint(["job-1", "job-2"])
  );
});
