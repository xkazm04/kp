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
