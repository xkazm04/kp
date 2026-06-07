// Locks the completed-vs-failed decision for a finished voice call (idea-3abeeb5f).
//
// The ElevenLabs SDK fires onDisconnect on every socket close, including the one
// right after onError and the one for a connect that never went live. Persisting
// those as "completed" scored a truncated transcript and set the scorecard_review
// approval feeding the Interview→Offer gate — a two-second blip became a "fully
// interviewed, scored applicant". These tests pin the rule so it can't regress:
// "completed" requires a live call with at least one real turn and no error;
// everything else is "failed" (which makes /api/interview/complete skip scoring).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewFinalStatus } from "./finalize-status.ts";

test("a live call with real turns and no error is completed", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 8 }),
    "completed",
  );
});

test("an error during the call forces failed even with a full transcript", () => {
  // The core bug: onError then onDisconnect on a call that had real turns. The
  // conversation was truncated by the blip, so it must not be scored.
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: 12 }),
    "failed",
  );
});

test("a disconnect before the call ever went live is failed", () => {
  // Connect dropped before onConnect — no real conversation happened.
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: false, turnCount: 0 }),
    "failed",
  );
});

test("a live call that produced zero turns is failed (nothing to score)", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 0 }),
    "failed",
  );
});

test("an errored connect that never went live is failed", () => {
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: false, turnCount: 0 }),
    "failed",
  );
});

test("only the happy path returns completed — every signal must line up", () => {
  // Exhaustive truth table: completed iff reachedLive && turnCount>0 && !errored.
  for (const errored of [false, true]) {
    for (const reachedLive of [false, true]) {
      for (const turnCount of [0, 3]) {
        const expected = !errored && reachedLive && turnCount > 0 ? "completed" : "failed";
        assert.equal(
          interviewFinalStatus({ errored, reachedLive, turnCount }),
          expected,
          `errored=${errored} reachedLive=${reachedLive} turnCount=${turnCount}`,
        );
      }
    }
  }
});
