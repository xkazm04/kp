// Brief-construction unit tests for the imported interview-kit questions feature
// (Direction 1): imported questions (prep payload `importedQuestions`) reach the
// grounded voice brief. composeBrief + importedQuestionsForBrief are pure (no DB),
// so they are testable directly. The candidate-safe path is exercised through the
// same allow-list sanitizer these tests pin in candidate-brief.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { candidateRunOfShow, composeBrief, importedQuestionsForBrief, MAX_BRIEF_IMPORTED_QUESTIONS } from "./interview-run.ts";

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

// ---------------------------------------------------------------------------
// candidateRunOfShow — the STORED, candidate-facing agenda
// (interview_sessions.run_of_show_json). The chronology `topic` is the LLM's
// free-text competency written under an interviewer prompt that asks it to cover
// the missing must-haves, so it comes back with the assessment annotation riding
// INSIDE the label as a bracketed aside. That stored field is rendered straight
// to the candidate by the interview portal's agenda sidebar (and returned by
// /api/interview/simulate), which is why it is composed clean at the SOURCE here
// rather than scrubbed at each render site. Same shape rule as the client-sent EL
// brief (voice/candidate-brief.ts::candidateSafeTopic).
// ---------------------------------------------------------------------------

const ANNOTATED = [
  { fromMin: 0, toMin: 8, topic: "Test automation fundamentals (missing must-have)", goal: "g", questions: [] },
  { fromMin: 8, toMin: 14, topic: "Motivation (aspiration mismatch)", goal: "g", questions: [] },
  { fromMin: 14, toMin: 20, topic: "Design trade-offs", goal: "g", questions: [] },
];

test("candidateRunOfShow: the interviewer's gap annotations never reach the stored candidate agenda", () => {
  const agenda = candidateRunOfShow(ANNOTATED);
  assert.deepEqual(agenda, ["Test automation fundamentals", "Motivation", "Design trade-offs"]);
  // Nothing bracketed survives at all — the shape rule, not a phrase deny-list.
  for (const item of agenda) assert.doesNotMatch(item, /[([]/, `"${item}" still carries an aside`);
});

test("candidateRunOfShow: an UNTERMINATED aside takes the rest of the label with it", () => {
  // The annotation shape the model actually emits is not always well-formed.
  assert.deepEqual(
    candidateRunOfShow([{ fromMin: 0, toMin: 8, topic: "Ownership of the payments service (missing must-have", goal: "g", questions: [] }]),
    ["Ownership of the payments service"]
  );
});

test("candidateRunOfShow: a label that is NOTHING but an annotation drops out entirely", () => {
  assert.deepEqual(
    candidateRunOfShow([
      { fromMin: 0, toMin: 8, topic: "(missing must-have)", goal: "g", questions: [] },
      { fromMin: 8, toMin: 16, topic: "Recent backend ownership", goal: "g", questions: [] },
    ]),
    ["Recent backend ownership"]
  );
});

test("candidateRunOfShow: a clean plan is byte-identical to the raw topic projection", () => {
  // Regression guard: the scrub must not re-word an ordinary agenda.
  assert.deepEqual(candidateRunOfShow(CHRON), CHRON.map((b) => b.topic));
  assert.deepEqual(candidateRunOfShow(undefined), []);
  assert.deepEqual(candidateRunOfShow([]), []);
});

test("candidateRunOfShow does NOT scrub the interviewer brief — the annotation is the point there", () => {
  // The brief is server-side, interviewer-internal material (/api/interview/complete's
  // public projection strips it); only the candidate-facing agenda is scrubbed.
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", { chronology: ANNOTATED, durationMin: 20 }, 20);
  assert.match(brief, /missing must-have/, "the interviewer still sees which must-have the topic covers");
});

// --- source guards ----------------------------------------------------------

test("runInterviewScorecard REQUIRES a workspace — no default tenant", () => {
  // It used to read `workspaceId: string = DEFAULT_WORKSPACE_ID`. A caller that
  // forgot the argument then scored, re-read the entry for telemetry and minted
  // observed skills against the FIRST team — silently wrong on every other one, and
  // invisible in a single-tenant install. The default is gone; the shape is asserted
  // on the source because a required parameter is a compile-time property that no
  // runtime call can demonstrate (`tsc` is the real enforcement, this is the tripwire
  // for anyone re-adding the default to "fix" a caller).
  const src = readFileSync(new URL("./interview-run.ts", import.meta.url), "utf8");
  assert.match(src, /export async function runInterviewScorecard\(/);
  assert.equal(/workspaceId: string = DEFAULT_WORKSPACE_ID/.test(src), false, "no default-tenant fallback");
  assert.equal(/^import .*DEFAULT_WORKSPACE_ID.* from/m.test(src), false, "and the import is gone with it");
  // The one caller derives the entry's team (token flow, no session workspace).
  const complete = readFileSync(new URL("../api/interview/complete/route.ts", import.meta.url), "utf8");
  assert.match(complete, /runInterviewScorecard\(session\.entryId, transcript, ws\)/);
});

test("each shared prompt paragraph is written once, and both briefs read the same one", () => {
  const src = readFileSync(new URL("./interview-run.ts", import.meta.url), "utf8");
  // The no-feedback closing rule and the role-context derivation were byte-duplicated
  // across the two briefs, so a wording fix landed in one and not the other.
  assert.equal((src.match(/Do not give feedback, scores, or any hiring decision/g) ?? []).length, 1);
  assert.equal((src.match(/noJudgementClose\("the (agenda is|questions are)"\)/g) ?? []).length, 2);
  assert.equal((src.match(/const company = job\?\.company \|\| /g) ?? []).length, 1);
  assert.equal((src.match(/entryBriefContext\(entry\)/g) ?? []).length, 2);
  // …and the deduped closer still renders both variants verbatim.
  const brief = composeBrief("Acme", "Engineer", "Engineer (senior)", { chronology: CHRON, durationMin: 20 }, 20);
  assert.match(brief, /When the agenda is covered, invite the candidate's questions/);
  assert.match(brief, /avoid “great”, “impressive”, “exactly right”/);
});
