// Brief-construction unit tests for the imported interview-kit questions feature
// (Direction 1): imported questions (prep payload `importedQuestions`) reach the
// grounded voice brief. composeBrief + importedQuestionsForBrief are pure (no DB),
// so they are testable directly. The candidate-safe path is exercised through the
// same allow-list sanitizer these tests pin in candidate-brief.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBrief, importedQuestionsForBrief, MAX_BRIEF_IMPORTED_QUESTIONS } from "./interview-run.ts";

const CHRON = [
  { fromMin: 0, toMin: 8, topic: "Recent backend ownership", goal: "Depth on the service they own.", questions: ["Walk me through the service you own end to end."] },
  { fromMin: 8, toMin: 16, topic: "Design trade-offs", goal: "How they reason about alternatives.", questions: ["Why an event queue over direct calls?"], followUp: "What breaks first under 10× load?" },
];

const prep = (extra: Record<string, unknown> = {}) => ({ scenario: "senior", durationMin: 20, chronology: CHRON, ...extra });

test("importedQuestionsForBrief: trims, drops blanks/non-strings, de-dupes, guards against already-asked", () => {
  const out = importedQuestionsForBrief(
    ["  Ask about testing  ", "Ask about testing", "", 42, null, "Why an event queue over direct calls?", "Fresh question"],
    ["Why an event queue over direct calls?"]
  );
  assert.deepEqual(out, ["Ask about testing", "Fresh question"]);
});

test("importedQuestionsForBrief: non-array / absent yields empty", () => {
  assert.deepEqual(importedQuestionsForBrief(undefined, []), []);
  assert.deepEqual(importedQuestionsForBrief("not an array", []), []);
});

test("composeBrief: absent vs empty importedQuestions is byte-identical to no-imports", () => {
  const base = composeBrief("Acme", "Engineer", "Engineer (senior)", prep(), 20);
  const withEmpty = composeBrief("Acme", "Engineer", "Engineer (senior)", prep({ importedQuestions: [] }), 20);
  const withBlanks = composeBrief("Acme", "Engineer", "Engineer (senior)", prep({ importedQuestions: ["", "   "] }), 20);
  assert.equal(withEmpty, base);
  assert.equal(withBlanks, base);
});

test("composeBrief: imported questions appear as an appended run-of-show block", () => {
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", prep({ importedQuestions: ["How do you approach flaky tests?"] }), 20);
  assert.match(brief, /recruiter-added questions/i);
  assert.match(brief, /How do you approach flaky tests\?/);
  // The generated chronology is still present and comes first.
  assert.match(brief, /Recent backend ownership/);
  assert.ok(brief.indexOf("Recent backend ownership") < brief.indexOf("How do you approach flaky tests?"));
});

test("composeBrief: an imported question already asked in the chronology is not double-rendered", () => {
  const dup = "Why an event queue over direct calls?";
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", prep({ importedQuestions: [dup] }), 20);
  // The chronology asks it once; the imported block must be absent entirely.
  assert.equal(brief.split(dup).length - 1, 1, "duplicate question must appear exactly once");
  assert.doesNotMatch(brief, /recruiter-added questions/i);
});

test("composeBrief: over-cap imports are capped and the cap is stated in prose", () => {
  const many = Array.from({ length: MAX_BRIEF_IMPORTED_QUESTIONS + 4 }, (_, i) => `Imported question number ${i + 1}`);
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", prep({ importedQuestions: many }), 20);
  assert.match(brief, new RegExp(`the first ${MAX_BRIEF_IMPORTED_QUESTIONS} of ${many.length}`));
  assert.match(brief, /Imported question number 1\b/);
  // The (MAX+1)th and beyond are dropped.
  assert.doesNotMatch(brief, new RegExp(`Imported question number ${MAX_BRIEF_IMPORTED_QUESTIONS + 1}\\b`));
});

test("composeBrief: no chronology falls back to the default brief (imports need a grounded plan)", () => {
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", { importedQuestions: ["orphan"] }, 20);
  assert.doesNotMatch(brief, /orphan/);
});
