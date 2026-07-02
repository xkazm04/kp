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

test("THE FIX: github evidence splits the key for screen/prep/scorecard; other tasks ignore it", () => {
  // GH7 — those three prompts render the entry's "Public repo evidence" block,
  // so a refreshed deep-dive (or evidence appearing on a previously bare entry)
  // must invalidate the 168h cache instead of a stale HIT serving a verdict the
  // AI formed without it.
  const evidence = JSON.stringify({ username: "ada-dev", confirmedSkills: ["python"] });
  const refreshed = JSON.stringify({ username: "ada-dev", confirmedSkills: ["python", "rust"] });
  const consumers: Array<[string, string]> = [
    ["screen", "screening-v1"],
    ["prep", "interview-prep-v1"],
    ["scorecard", "scorecard-v3"],
  ];
  for (const [task, version] of consumers) {
    const t = { ...base, task, version };
    // Evidence appearing on a bare entry changes the key...
    assert.notEqual(
      computeAutomationCacheKey(t),
      computeAutomationCacheKey({ ...t, githubEvidenceJson: evidence }),
      task
    );
    // ...and a refreshed deep-dive changes it again.
    assert.notEqual(
      computeAutomationCacheKey({ ...t, githubEvidenceJson: evidence }),
      computeAutomationCacheKey({ ...t, githubEvidenceJson: refreshed }),
      task
    );
  }
  // A task whose prompt never reads the evidence must not split on it (mirrors
  // the stage/notes/corpus task-scoping above).
  const outreach = { ...base, task: "outreach", version: "outreach-v1" };
  assert.equal(
    computeAutomationCacheKey(outreach),
    computeAutomationCacheKey({ ...outreach, githubEvidenceJson: evidence })
  );
});

test("the locale splits the key for prep AND the letter tasks; non-lang tasks ignore it", () => {
  // Backlog #34 — the letter tasks (outreach/rejection/offer) render in the
  // entry's resolved comms locale, so a locale fix (or a workspace-default
  // change) must genuinely re-draft instead of a stale HIT serving the
  // wrong-language letter for the full 168h TTL. prep keeps its PREP2 axis.
  for (const [task, version] of [
    ["prep", "interview-prep-v1"],
    ["outreach", "outreach-v2"],
    ["rejection", "rejection-v2"],
    ["offer", "offer-v2"],
  ] as Array<[string, string]>) {
    const t = { ...base, task, version };
    assert.notEqual(
      computeAutomationCacheKey({ ...t, lang: "en" }),
      computeAutomationCacheKey({ ...t, lang: "cs" }),
      task
    );
  }
  // screen's verdict is language-free — a lang must not split its key.
  const screen = { ...base, task: "screen", version: "screening-v1" };
  assert.equal(
    computeAutomationCacheKey({ ...screen, lang: "en" }),
    computeAutomationCacheKey({ ...screen, lang: "cs" })
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
