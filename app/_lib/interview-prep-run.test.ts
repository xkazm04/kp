// Pins the INVERTED regeneration merge (mergeRegeneratedPrep). The old code carried
// human input across a Regenerate via a hardcoded 3-key allowlist
// (["humanScorecard","userProgress","interviewer"]); any human-authored payload key
// not on that list was silently destroyed. The fix inverts the default: preserve
// EVERY previous key, overwrite ONLY the generator's keys. These tests plant an
// unknown human key and prove it survives a regeneration.
// Runner: node --test with the repo's alias loader (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRegeneratedPrep } from "./interview-prep-run.ts";

const generated = {
  scenario: "A 20-minute structured interview.",
  durationMin: 20,
  focusAreas: ["depth"],
  chronology: [],
  signals: [],
  source: "llm",
  lang: "en",
};

test("mergeRegeneratedPrep: an UNKNOWN human key survives a regeneration (the allowlist bug)", () => {
  const prev = {
    scenario: "old scenario",
    durationMin: 15,
    humanScorecard: { ratings: [{ competency: "Communication", rating: 4 }], source: "human" },
    userProgress: { checked: { "c-0": true }, notes: "solid on system design" },
    interviewer: "amy@corp.test",
    // A future human-authored key nobody wrote an allowlist entry for.
    recruiterNotes: "call the reference before the loop",
  };
  const merged = mergeRegeneratedPrep(prev, generated);

  // The generator's keys are overwritten...
  assert.equal(merged.scenario, generated.scenario, "generated scenario wins");
  assert.equal(merged.durationMin, 20, "generated durationMin wins");
  assert.equal(merged.source, "llm");

  // ...every human key is preserved, including the one no allowlist knew about.
  assert.equal(merged.recruiterNotes, "call the reference before the loop", "unknown human key survives Regenerate");
  assert.deepEqual(merged.humanScorecard, prev.humanScorecard, "humanScorecard preserved");
  assert.deepEqual(merged.userProgress, prev.userProgress, "userProgress preserved");
  assert.equal(merged.interviewer, "amy@corp.test", "interviewer preserved");
});

test("mergeRegeneratedPrep: a first generation (no prior payload) yields exactly the generated keys", () => {
  const merged = mergeRegeneratedPrep(null, generated);
  assert.deepEqual(merged, generated);
});

test("mergeRegeneratedPrep: the generator OWNS its keys — a stale generated field is overwritten, not merged", () => {
  // Prove overwrite semantics: a prior payload's copy of a GENERATED key does not
  // survive (only human keys do). A previous focusAreas is replaced wholesale.
  const prev = { focusAreas: ["stale", "old"], signals: ["stale signal"], humanScorecard: { source: "human" } };
  const merged = mergeRegeneratedPrep(prev, generated);
  assert.deepEqual(merged.focusAreas, ["depth"], "generated focusAreas replaces the stale one");
  assert.deepEqual(merged.signals, [], "generated signals replaces the stale one");
  assert.deepEqual(merged.humanScorecard, { source: "human" }, "human key still preserved");
});

test("mergeRegeneratedPrep: the recruiter's per-candidate kit OVERLAY survives a regeneration", () => {
  // spark interview-kit-template, WP-C: `kitOverlay` is the recruiter's drops, rewrites
  // and additions on the job interview kit for THIS candidate (PATCH /api/interview-prep
  // { kitOverlay }). The generator never writes it, so a Regenerate must carry it — and
  // must carry it VERBATIM, since the agenda re-applies it by question id at connect.
  const kitOverlay = {
    version: 1,
    dropped: ["q-first", "cv-1234abcd"],
    edited: [{ id: "q-healthy", text: "What does a suite you trust look like?" }],
    added: [{ id: "ov-a", competencyId: "c-collab", text: "Who do you pair with?", mustAsk: true }],
  };
  const prev = { scenario: "old", chronology: [{ topic: "Old", questions: ["Old probe?"] }], kitOverlay, userProgress: { notes: "n" } };
  const merged = mergeRegeneratedPrep(prev, generated);
  assert.deepEqual(merged.kitOverlay, kitOverlay, "the overlay is carried across the regeneration untouched");
  assert.deepEqual(merged.chronology, [], "while the plan it rides on is replaced");
  assert.equal("kitOverlay" in generated, false, "the generator owns no kitOverlay key to overwrite it with");
});

test("mergeRegeneratedPrep: an unstaged regeneration never carries a stale pendingPlan forward", () => {
  // r09 schedule-interview-prep/B: a modal Regenerate stages its plan under `pendingPlan`.
  // A later UNSTAGED regeneration (the Decisions-queue accept) commits a newer plan, so the
  // staged candidate describes a plan that is no longer the alternative to anything.
  const humanScorecards = [{ ratings: [], source: "human", author: "u1", authorLabel: "Amy", stage: "interview", savedAt: "2026-09-20T10:00:00.000Z" }];
  const prev = { scenario: "old", pendingPlan: { scenario: "staged" }, humanScorecards, userProgress: { notes: "n" } };
  const merged = mergeRegeneratedPrep(prev, generated);
  assert.equal("pendingPlan" in merged, false, "the staged candidate is dropped");
  assert.deepEqual(merged.humanScorecards, humanScorecards, "every human key still rides through");
  assert.deepEqual(merged.userProgress, { notes: "n" });
});
