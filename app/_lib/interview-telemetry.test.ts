// Pins the interview telemetry proxies: counters, timestamp-derived gaps, and —
// the one that matters most for the early-career model — the scripted-hint
// uptake classifier. These signals ride the scorecard so potential_score's
// weights can later be validated against outcomes; a silent drift here would
// poison that dataset, hence the pinning.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTelemetry, hintLineFromProbe } from "./interview-telemetry.ts";
import type { VoiceTurn } from "./voice/types.ts";

const HINT_PROBE =
  "Mid-discussion, offer ONE gentle hint: “Could the same shipping event ever arrive on the queue twice?” and observe whether they integrate it.";

const at = (sec: number): string => new Date(Date.UTC(2026, 0, 1, 10, 0, sec)).toISOString();

function turn(role: VoiceTurn["role"], text: string, sec?: number): VoiceTurn {
  return sec === undefined ? { role, text } : { role, text, at: at(sec) };
}

// ---------------------------------------------------------------------------
// hintLineFromProbe — the candidate only ever hears the quoted line
// ---------------------------------------------------------------------------

test("extracts the quoted spoken line from a scripted probe", () => {
  assert.equal(hintLineFromProbe(HINT_PROBE), "Could the same shipping event ever arrive on the queue twice?");
});

test("falls back to the whole probe when nothing is quoted", () => {
  assert.equal(hintLineFromProbe("Ask about their proudest project."), "Ask about their proudest project.");
});

test("null/blank probes yield null", () => {
  assert.equal(hintLineFromProbe(null), null);
  assert.equal(hintLineFromProbe("   "), null);
});

// ---------------------------------------------------------------------------
// counters + timestamps
// ---------------------------------------------------------------------------

const BASIC: VoiceTurn[] = [
  turn("interviewer", "Walk me through the project you are proudest of.", 0),
  turn("candidate", "I built a small REST API for lab scheduling in my thesis.", 10),
  turn("system", "noise that must not count"),
  turn("interviewer", "Why did you choose Postgres for it?", 40),
  turn("candidate", "Mostly because of transactions and the relational shape of the data.", 70),
];

test("counts turns and words per role, system excluded", () => {
  const t = extractTelemetry(BASIC);
  assert.equal(t.turns, 4);
  assert.equal(t.candidateTurns, 2);
  assert.equal(t.interviewerTurns, 2);
  assert.ok(t.candidateWords > 0 && t.interviewerWords > 0);
  assert.ok(t.talkRatio !== null && t.talkRatio > 0 && t.talkRatio < 1);
});

test("duration spans first to last stamped turn; gap proxy is the longest interviewer→candidate wait", () => {
  const t = extractTelemetry(BASIC);
  assert.equal(t.durationSec, 70);
  assert.equal(t.longestResponseGapSec, 30); // 40s probe → 70s answer
});

test("without timestamps the time proxies are null, never fabricated", () => {
  const t = extractTelemetry([turn("interviewer", "Hi"), turn("candidate", "Hello")]);
  assert.equal(t.durationSec, null);
  assert.equal(t.longestResponseGapSec, null);
});

// ---------------------------------------------------------------------------
// hint uptake — the coachability instrumentation
// ---------------------------------------------------------------------------

const HINT_TURN = turn(
  "interviewer",
  "One thing worth considering — could the same shipping event ever arrive on the queue twice?",
  100
);

test("no hint scripted → not_offered", () => {
  const t = extractTelemetry(BASIC, { hintText: null });
  assert.equal(t.hint.uptake, "not_offered");
  assert.equal(t.hint.offered, false);
});

test("hint scripted but never spoken → not_offered", () => {
  const t = extractTelemetry(BASIC, { hintText: HINT_PROBE });
  assert.equal(t.hint.offered, false);
  assert.equal(t.hint.uptake, "not_offered");
});

test("hint spoken, candidate works it into a substantive answer → integrated", () => {
  const transcript = [
    ...BASIC,
    HINT_TURN,
    turn(
      "candidate",
      "Oh — if the same shipping event can arrive twice from the queue, my design sends the email twice. I would make the consumer idempotent, maybe key the send on the event id, and store processed ids so a duplicate event is dropped.",
      130
    ),
  ];
  const t = extractTelemetry(transcript, { hintText: HINT_PROBE });
  assert.equal(t.hint.offered, true);
  assert.equal(t.hint.uptake, "integrated");
  assert.equal(t.hint.responseSec, 30);
});

test("brief mention only → acknowledged", () => {
  const transcript = [...BASIC, HINT_TURN, turn("candidate", "Right, a duplicate shipping event. Good point.", 120)];
  const t = extractTelemetry(transcript, { hintText: HINT_PROBE });
  assert.equal(t.hint.uptake, "acknowledged");
});

test("hint never referenced afterwards → missed", () => {
  const transcript = [...BASIC, HINT_TURN, turn("candidate", "Anyway, as I was saying, I like Postgres.", 115)];
  const t = extractTelemetry(transcript, { hintText: HINT_PROBE });
  assert.equal(t.hint.offered, true);
  assert.equal(t.hint.uptake, "missed");
});

test("an unrelated interviewer question never counts as the hint", () => {
  const transcript = [...BASIC, turn("interviewer", "What languages do you speak?", 90)];
  const t = extractTelemetry(transcript, { hintText: HINT_PROBE });
  assert.equal(t.hint.offered, false);
});
