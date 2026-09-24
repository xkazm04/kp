// The feedback-letter runner's contract with the drafting CLI, and the choice of which draft
// a recruiter reads (spark interview-feedback-letter, WP-alpha).
//
// Nothing here spawns Python: the CLI's own behaviour is pinned by
// pipeline/jobfit/tests/test_interview_letter.py, and the runner's paths that must never reach
// the CLI (a foreign letter id, a letter a person already decided, consent withheld) return
// before the spawn — which is exactly what is asserted.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LETTER_MAX_CHARS } from "./interview-letter-types.ts";

const { chooseLetterDraft, interviewLetterArgs, runInterviewLetter, toInterviewLetterEnvelope } = await import("./interview-letter-run.ts");
const { interviewLetterDecline, interviewLetterRequest } = await import("./db/interview-letters.ts");
const { createPipelineEntry } = await import("./db/pipeline.ts");
const { ensureDb } = await import("./db/core.ts");

after(() => cleanupUnitDb());

test("the envelope: body required, names filtered to strings, anything but `llm` is the template", () => {
  const ok = toInterviewLetterEnvelope({
    result: { body: "Hello.", wentWell: ["Technical depth", 3, null, ""], toWorkOn: "nope", promptVersion: "interview-letter-v1" },
    source: "llm",
  });
  assert.deepEqual(ok, {
    result: { body: "Hello.", wentWell: ["Technical depth"], toWorkOn: [], promptVersion: "interview-letter-v1" },
    source: "llm",
  });
  assert.equal(toInterviewLetterEnvelope({ result: { body: "" }, source: "heuristic" }).source, "deterministic");
  assert.equal(toInterviewLetterEnvelope({ result: { body: "" } }).source, "deterministic");
  assert.throws(() => toInterviewLetterEnvelope({ result: { wentWell: [] }, source: "llm" }), /missing result\.body/);
  assert.throws(() => toInterviewLetterEnvelope(null), /missing result\.body/);
});

test("the argv: no scorecard means no --scorecard-file, never an empty one", () => {
  assert.deepEqual(interviewLetterArgs("/w/letter.json", "/w/scorecard.json", "cs"), [
    "-m",
    "pipeline.jobfit.automation_cli",
    "interview-letter",
    "--letter-json",
    "/w/letter.json",
    "--scorecard-file",
    "/w/scorecard.json",
    "--lang",
    "cs",
  ]);
  assert.ok(!interviewLetterArgs("/w/letter.json", null, "en").includes("--scorecard-file"));
});

test("the model's letter is the draft only when the engine wrote it AND it is storable", () => {
  const template = "The catalog letter.";
  assert.deepEqual(chooseLetterDraft({ result: { body: "  A model letter.  " }, source: "llm" }, template), {
    text: "A model letter.",
    source: "model",
  });
  // The CLI's keyless / discarded answer is an empty body.
  assert.deepEqual(chooseLetterDraft({ result: { body: "" }, source: "llm" }, template), { text: template, source: "template" });
  assert.deepEqual(chooseLetterDraft({ result: { body: "Stray prose." }, source: "deterministic" }, template), {
    text: template,
    source: "template",
  });
  // Over the contract's cap: the store would refuse it, so it never becomes the draft.
  assert.deepEqual(chooseLetterDraft({ result: { body: "x".repeat(LETTER_MAX_CHARS + 1) }, source: "llm" }, template), {
    text: template,
    source: "template",
  });
});

function entry(ws: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return createPipelineEntry({
    candidateId: `c-ilr-${suffix}`,
    candidateLabel: "Runner Candidate",
    jobId: `job-ilr-${suffix}`,
    jobTitle: "Support Engineer",
    stage: "Interview",
    workspaceId: ws,
  }).entry;
}

test("a letter id from another team is unknown — the runner asserts ownership itself", async () => {
  const e = entry("team-alpha");
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "en", outcome: "not_selected" }, "team-alpha");
  await assert.rejects(() => runInterviewLetter(letter.id, undefined, "team-beta"), /interview letter not found/);
});

test("a letter a person already decided is not drafted again (no spawn, nothing saved)", async () => {
  const e = entry("team-alpha");
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "de", outcome: "not_selected" }, "team-alpha");
  interviewLetterDecline(letter.id, { decidedBy: "human:recruiter" }, "team-alpha");
  const result = await runInterviewLetter(letter.id, undefined, "team-alpha");
  assert.deepEqual(result, { letterId: letter.id, source: "deterministic", draftSource: "template", lang: "de", promptVersion: null, saved: false });
});

test("consent withheld at draft time → nothing is processed for the letter", async () => {
  const e = entry("team-alpha");
  const { letter } = interviewLetterRequest({ entryId: e.id, lang: "fr", outcome: "hired" }, "team-alpha");
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ? AND workspace_id = ?`)
    .run("2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", e.id, "team-alpha");
  const result = await runInterviewLetter(letter.id, undefined, "team-alpha");
  assert.equal(result.saved, false);
  assert.equal(result.lang, "fr");
  // The task result never carries the letter or the person — the tasks table outlives an erasure.
  assert.deepEqual(Object.keys(result).sort(), ["draftSource", "lang", "letterId", "promptVersion", "saved", "source"]);
});
