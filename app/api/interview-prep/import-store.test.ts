import "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { getInterviewPrep, saveInterviewPrep, type InterviewPrep } from "../../_lib/interview-prep.ts";
import { mergeRegeneratedPrep } from "../../_lib/interview-prep-run.ts";
import { assignImportedBlock, mergeImportedQuestions, readImported, readImportedEntries } from "./importMerge.ts";

after(() => cleanupUnitDb());

const load = (entry: string): InterviewPrep => {
  const prep = getInterviewPrep(entry);
  assert.ok(prep, "expected a persisted prep");
  return prep;
};

// One import step = the exact read-merge-write the POST route performs.
const doImport = (entry: string, questions: string[]): void => {
  const existing = load(entry);
  const merged = mergeImportedQuestions(readImportedEntries(existing.payload), questions);
  saveInterviewPrep(entry, existing.candidateLabel, existing.jobTitle, { ...existing.payload, importedQuestions: merged });
};

// One weave/unweave step = the exact read-merge-write the PATCH route performs.
const doWeave = (entry: string, question: string, blockRef: string | null): void => {
  const existing = load(entry);
  const merged = assignImportedBlock(readImportedEntries(existing.payload), question, blockRef);
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

// Direction 3 — weaving an imported question into a chronology block moves only its
// blockRef (single home: it stays in importedQuestions, never duplicated into the
// generator-owned chronology), and that blockRef survives a Regenerate.
test("weaving assigns a blockRef, keeps one home, and survives regenerate", () => {
  const entry = "e2e-weave-1";
  saveInterviewPrep(entry, "Ada", "Backend Engineer", {
    scenario: "A 20-minute structured interview.",
    durationMin: 20,
    focusAreas: [],
    chronology: [{ fromMin: 0, toMin: 5, topic: "Ownership", goal: "probe", questions: [] }],
    signals: [],
    source: "llm",
  });
  const kit = ["Describe a system you owned end-to-end.", "A tradeoff you regret?"];
  doImport(entry, kit);

  // Weave the first question into the "Ownership" block.
  doWeave(entry, kit[0], "Ownership");
  const woven = readImportedEntries(load(entry).payload);
  assert.deepEqual(woven, [{ question: kit[0], blockRef: "Ownership" }, { question: kit[1] }], "only the blockRef moved");
  // Still ONE array entry per question — never duplicated into chronology.questions.
  assert.equal((load(entry).payload.chronology as { questions: string[] }[])[0].questions.length, 0);

  // Regenerate: the plan is rebuilt but the woven blockRef is preserved by the
  // inverted merge (importedQuestions is not a generator-owned key).
  const regen = mergeRegeneratedPrep(load(entry).payload, {
    scenario: "A 25-minute structured interview.",
    durationMin: 25,
    focusAreas: [],
    chronology: [{ fromMin: 0, toMin: 5, topic: "Ownership", goal: "probe", questions: [] }],
    signals: [],
    source: "llm",
    lang: "en",
  });
  assert.deepEqual(readImportedEntries(regen), [{ question: kit[0], blockRef: "Ownership" }, { question: kit[1] }], "the weave survives regenerate");

  // Unweave: blockRef cleared, question returned to the unassigned pool.
  doWeave(entry, kit[0], null);
  assert.deepEqual(readImportedEntries(load(entry).payload), [{ question: kit[0] }, { question: kit[1] }]);
});

test("assignImportedBlock: back-compatible with legacy plain-string entries; idempotent", () => {
  // A legacy payload stored plain strings — readImportedEntries normalizes them, and
  // weaving one still works without touching the others.
  const legacy = { importedQuestions: ["Q one", "Q two"] } as Record<string, unknown>;
  const entries = readImportedEntries(legacy);
  assert.deepEqual(entries, [{ question: "Q one" }, { question: "Q two" }]);

  const woven = assignImportedBlock(entries, "Q one", "Intro");
  assert.deepEqual(woven, [{ question: "Q one", blockRef: "Intro" }, { question: "Q two" }]);
  // Weaving to the same block again is a no-op (idempotent).
  assert.deepEqual(assignImportedBlock(woven, "Q one", "Intro"), woven);
  // Assigning a question that isn't present leaves the list unchanged.
  assert.deepEqual(assignImportedBlock(woven, "not present", "Intro"), woven);
});

test("mergeImportedQuestions preserves prior blockRefs and dedupes new plain imports", () => {
  const prior = [{ question: "kept", blockRef: "Deep dive" }, { question: "plain" }];
  const merged = mergeImportedQuestions(prior, ["plain", "fresh"]);
  assert.deepEqual(merged, [
    { question: "kept", blockRef: "Deep dive" }, // blockRef survives a re-import
    { question: "plain" }, // dedup — no stacking
    { question: "fresh" }, // new appended as unassigned
  ]);
});
