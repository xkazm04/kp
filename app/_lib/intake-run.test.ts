// The intake runner's two boundaries that had none: a per-turn BUDGET, and the
// size of the transcript it serialises into the spawn workdir.
//
// Both were inherited defaults. Every conversational turn ran under
// python-runner's ten-minute HANG backstop, so a stalled provider held the
// requestor on a spinner for nine minutes past the point the answer was useful;
// and the whole stored transcript was written to disk on every spawn even
// though pipeline/jobfit/intake.py renders only its newest 48 turns.
//
// Pure surface only — spawning Python is the route tests' job.
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VoiceTurn } from "./voice/types.ts";
import {
  INTAKE_APP_MASTER_TIMEOUT_MS,
  INTAKE_DIALOG_TIMEOUT_MS,
  INTAKE_EXTRACT_TIMEOUT_MS,
  INTAKE_OPENING_TIMEOUT_MS,
  INTAKE_VOICE_TURN_TIMEOUT_MS,
  IntakeTimeoutError,
  MAX_SPAWN_TRANSCRIPT_TURNS,
  isSpawnTimeoutMessage,
  transcriptWindow,
} from "./intake-run.ts";
import { MAX_STORED_TURNS } from "./intake-transcript.ts";

test("every intake thread carries a budget, and none of them is the 10-minute default", () => {
  const budgets = [
    INTAKE_OPENING_TIMEOUT_MS,
    INTAKE_DIALOG_TIMEOUT_MS,
    INTAKE_VOICE_TURN_TIMEOUT_MS,
    INTAKE_EXTRACT_TIMEOUT_MS,
    INTAKE_APP_MASTER_TIMEOUT_MS,
  ];
  for (const ms of budgets) {
    assert.ok(ms > 0 && ms < 600_000, `${ms}ms must be a real deadline, not the hang backstop`);
  }
  // A spoken turn is answered at speech pace or not at all; a typed one may
  // think; a batch pass over a whole transcript may think longest.
  assert.ok(INTAKE_VOICE_TURN_TIMEOUT_MS < INTAKE_DIALOG_TIMEOUT_MS);
  assert.ok(INTAKE_DIALOG_TIMEOUT_MS < INTAKE_EXTRACT_TIMEOUT_MS);
});

test("python-runner's deadline message is recognised — and nothing else is", () => {
  assert.equal(isSpawnTimeoutMessage("Python process timed out after 120s: -m pipeline.jobfit.intake_cli"), true);
  assert.equal(isSpawnTimeoutMessage("Python process aborted"), false);
  assert.equal(isSpawnTimeoutMessage("TimeoutError: read timed out"), false);
  assert.equal(isSpawnTimeoutMessage("Python process output exceeded 32 MB and was terminated"), false);
});

test("a timeout is a named decision, not an anonymous 500", () => {
  const err = new IntakeTimeoutError(45_000);
  assert.ok(err instanceof Error);
  assert.equal(err.name, "IntakeTimeoutError");
  assert.equal(err.budgetMs, 45_000);
  assert.match(err.message, /45s/, "the budget it overran is stated, for the server log");
});

test("the spawn writes the engine's window, not the whole transcript", () => {
  // The store caps at MAX_STORED_TURNS plus at most one compaction marker, so
  // the window must be exactly that — equal windows keep `sourceTurn` citations
  // numbered the same on both sides of the boundary.
  assert.equal(MAX_SPAWN_TRANSCRIPT_TURNS, MAX_STORED_TURNS + 1);
  const long: VoiceTurn[] = Array.from({ length: 300 }, (_, i) => ({ role: "candidate", text: `t${i}` }));
  const windowed = transcriptWindow(long);
  assert.equal(windowed.length, MAX_SPAWN_TRANSCRIPT_TURNS);
  assert.equal(windowed.at(-1)?.text, "t299", "the NEWEST turns survive");
  const short = long.slice(0, 10);
  assert.equal(transcriptWindow(short), short, "a short transcript is not copied");
});
