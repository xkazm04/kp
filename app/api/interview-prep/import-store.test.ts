import "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { getInterviewPrep, saveInterviewPrep, type InterviewPrep } from "../../_lib/interview-prep.ts";
import { mergeRegeneratedPrep } from "../../_lib/interview-prep-run.ts";
import { mergeImportedQuestions, readImported } from "./importMerge.ts";

after(() => cleanupUnitDb());

const load = (entry: string): InterviewPrep => {
  const prep = getInterviewPrep(entry);
  assert.ok(prep, "expected a persisted prep");
  return prep;
};

// One import step = the exact read-merge-write the POST route performs.
const doImport = (entry: string, questions: string[]): void => {
  const existing = load(entry);
  const merged = mergeImportedQuestions(readImported(existing.payload), questions);
  saveInterviewPrep(entry, existing.candidateLabel, existing.jobTitle, { ...existing.payload, importedQuestions: merged });
};

// Drives the real POST read-merge-write path against an isolated DB.
test("import writes importedQuestions, preserves plan, is idempotent, survives regenerate", () => {
  const entry = "e2e-entry-1";
  // Seed a generated pack (what runInterviewPrep would have saved).
  saveInterviewPrep(entry, "Jane Doe", "Backend Engineer", {
    scenario: "A 20-minute structured interview.",
    durationMin: 20,
    focusAreas: ["ownership"],
    chronology: [{ fromMin: 0, toMin: 3, topic: "Intro", goal: "settle", questions: [] }],
    signals: ["Probed depth"],
    source: "llm",
    userProgress: { checked: { "c-0": true }, notes: "kept" },
  });

  const kit = ["Describe a system you owned end-to-end.", "A tradeoff you regret?"];
  doImport(entry, kit);

  const after1 = load(entry);
  assert.deepEqual(readImported(after1.payload), kit);
  // Generated plan + human progress preserved.
  assert.equal(after1.payload.durationMin, 20);
  assert.deepEqual(after1.payload.userProgress, { checked: { "c-0": true }, notes: "kept" });

  // Re-import the same kit: idempotent, no stacking (the duplicate-import guard).
  doImport(entry, kit);
  assert.deepEqual(readImported(load(entry).payload), kit);

  // Regenerate the plan — importedQuestions must survive (preserve-by-default).
  const regen = mergeRegeneratedPrep(load(entry).payload, {
    scenario: "A 25-minute structured interview.",
    durationMin: 25,
    focusAreas: ["depth"],
    chronology: [],
    signals: ["new"],
    source: "llm",
    lang: "en",
  });
  assert.deepEqual(readImported(regen), kit);
  assert.equal(regen.durationMin, 25); // plan overwritten
});
