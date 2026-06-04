// Locks the transcript truncation policy that gates Interview→Offer (idea-c1b2313e).
//
// The scorecard scores only what buildScorecardNotes hands it, so the truncation
// policy is trust-critical, not incidental string-slicing. These tests pin the
// decisions documented in interview-transcript.ts so they can't silently regress:
//
//   - A transcript within budget is passed WHOLE and is not flagged truncated.
//   - Over budget we head+tail sample: the OPENING and — the property that the old
//     front-slice broke — the CLOSING/conclusion are preserved, the middle is
//     dropped behind an explicit in-band marker, and the metadata reports exactly
//     what was discarded so runInterviewScorecard can warn. The conclusion of a
//     long screen must never vanish unmarked again.
//   - The per-turn clamp (clampTurn) reports the chars it discarded, so an
//     abnormally long turn is visible rather than silent.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { InterviewTurn } from "./db.ts";
import {
  MAX_TURN_TEXT_CHARS,
  MAX_SCORECARD_NOTES_CHARS,
  clampTurn,
  transcriptToNotes,
  buildScorecardNotes,
} from "./interview-transcript.ts";

const turn = (role: InterviewTurn["role"], text: string, at?: string): InterviewTurn => ({
  role,
  text,
  at,
});

// ---------------------------------------------------------------------------
// transcriptToNotes
// ---------------------------------------------------------------------------

test("transcriptToNotes flattens to 'Speaker: text' with canonical labels", () => {
  const notes = transcriptToNotes([
    turn("interviewer", "Tell me about yourself."),
    turn("candidate", "Sure, I studied CS."),
    turn("system", "call connected"),
  ]);
  assert.equal(
    notes,
    "Interviewer: Tell me about yourself.\nCandidate: Sure, I studied CS.\nSystem: call connected",
  );
});

// ---------------------------------------------------------------------------
// clampTurn — per-turn sanity cap, visible when it bites
// ---------------------------------------------------------------------------

test("clampTurn leaves a normal turn untouched and reports zero clipped chars", () => {
  const { turn: t, clippedChars } = clampTurn({ role: "candidate", text: "short answer", at: "t0" });
  assert.deepEqual(t, { role: "candidate", text: "short answer", at: "t0" });
  assert.equal(clippedChars, 0);
});

test("clampTurn normalizes unknown / missing roles to 'system'", () => {
  assert.equal(clampTurn({ role: "bot", text: "x" }).turn.role, "system");
  assert.equal(clampTurn({ text: "x" }).turn.role, "system");
  // Canonical roles pass through unchanged.
  assert.equal(clampTurn({ role: "candidate", text: "x" }).turn.role, "candidate");
  assert.equal(clampTurn({ role: "interviewer", text: "x" }).turn.role, "interviewer");
});

test("clampTurn clamps an oversized turn and reports exactly how much it discarded", () => {
  const over = 137;
  const full = "y".repeat(MAX_TURN_TEXT_CHARS + over);
  const { turn: t, clippedChars } = clampTurn({ role: "candidate", text: full });
  assert.equal(t.text.length, MAX_TURN_TEXT_CHARS);
  assert.equal(clippedChars, over);
});

test("clampTurn coerces non-string text via String() before clamping", () => {
  // Defensive: the API filters non-string text upstream, but the clamp must not
  // throw if a number/null slips in — it stringifies first.
  const { turn: t, clippedChars } = clampTurn({ role: "candidate", text: 42 as unknown });
  assert.equal(t.text, "42");
  assert.equal(clippedChars, 0);
});

// ---------------------------------------------------------------------------
// buildScorecardNotes — head+tail sampling policy
// ---------------------------------------------------------------------------

test("a within-budget transcript is passed whole and not flagged truncated", () => {
  const transcript = [
    turn("interviewer", "Hi there."),
    turn("candidate", "Hello!"),
    turn("interviewer", "Thanks, that's all."),
  ];
  const r = buildScorecardNotes(transcript);
  assert.equal(r.truncated, false);
  assert.equal(r.droppedTurns, 0);
  assert.equal(r.droppedChars, 0);
  assert.equal(r.keptTurns, 3);
  assert.equal(r.totalTurns, 3);
  assert.equal(r.notes, transcriptToNotes(transcript));
});

test("an over-budget transcript keeps opening AND closing, drops the middle behind a marker", () => {
  // ~400 chars/turn × 40 turns ≈ 16k chars, well over the 6k budget. Distinctive
  // markers at the boundaries and the middle let us assert what survives.
  const pad = (s: string) => `${s}_${"x".repeat(380)}`;
  const last = 39;
  const transcript: InterviewTurn[] = Array.from({ length: 40 }, (_, i) =>
    turn(
      i % 2 === 0 ? "interviewer" : "candidate",
      pad(i === 0 ? "OPENING" : i === last ? "CLOSING" : i === 20 ? "MIDDLE" : `mid${i}`),
    ),
  );

  const r = buildScorecardNotes(transcript);

  assert.equal(r.truncated, true);
  assert.equal(r.totalTurns, 40);
  // The opening context survives.
  assert.ok(r.notes.includes("OPENING"), "opening turn must be kept");
  // The CONCLUSION survives — the exact property the old `.slice(0, 6000)` broke.
  assert.ok(r.notes.includes("CLOSING"), "closing turn must be kept");
  // A genuinely-middle turn is dropped.
  assert.ok(!r.notes.includes("MIDDLE"), "middle turn must be dropped");
  // The scorer is told in-band that it is reading a sampled transcript.
  assert.ok(r.notes.includes("omitted from the middle"), "in-band truncation marker present");
  // Metadata is internally consistent and records a real loss.
  assert.ok(r.droppedTurns > 0);
  assert.ok(r.droppedChars > 0);
  assert.equal(r.keptTurns + r.droppedTurns, r.totalTurns, "kept + dropped accounts for every turn");
  // The sampled notes honor the budget (small-turn case: head+tail+marker fit).
  assert.ok(
    r.notes.length <= MAX_SCORECARD_NOTES_CHARS,
    `sampled notes (${r.notes.length}) must fit MAX_SCORECARD_NOTES_CHARS (${MAX_SCORECARD_NOTES_CHARS})`,
  );
});

test("a single turn larger than the whole budget is front-clipped and tail-marked", () => {
  // Degenerate case: no turn boundary to sample on. We keep the front and mark
  // the dropped tail rather than silently returning a clipped blob.
  const huge = turn("candidate", "z".repeat(MAX_SCORECARD_NOTES_CHARS + 1500));
  const r = buildScorecardNotes([huge]);
  assert.equal(r.truncated, true);
  assert.equal(r.totalTurns, 1);
  assert.equal(r.keptTurns, 1);
  assert.equal(r.droppedTurns, 0); // no whole turns to drop
  assert.ok(r.droppedChars > 0);
  assert.ok(r.notes.includes("omitted from the middle"), "tail marker present");
});

test("an empty transcript yields empty, untruncated notes", () => {
  const r = buildScorecardNotes([]);
  assert.equal(r.notes, "");
  assert.equal(r.truncated, false);
  assert.equal(r.totalTurns, 0);
  assert.equal(r.keptTurns, 0);
});
