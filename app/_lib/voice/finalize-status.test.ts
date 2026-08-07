// Locks the completed-vs-failed decision for a finished voice call (idea-3abeeb5f).
//
// The ElevenLabs SDK fires onDisconnect on every socket close, including the one
// right after onError and the one for a connect that never went live. Persisting
// a two-second blip as "completed" scored a truncated transcript and set the
// scorecard_review approval feeding the Interview→Offer gate.
//
// bug-ui-scan-2026-07-09 (voice-interview #2): the original rule made ANY error
// strictly disqualifying, which ALSO failed a fully-answered interview whose
// socket merely blipped at goodbye — silently stalling a real screen. The rule
// now decouples "clean teardown" from "scoreable": a live call that captured a
// substantive conversation (>= SUBSTANTIVE_TURNS turns) is "completed" even after
// a late error, while a short blip stays "failed".
//
// voice-interview #1 (this scan): "real conversation" now requires a CANDIDATE
// turn, not a turn of any role — the AI interviewer always opens, so a silent-mic
// call (candidateTurnCount 0, turnCount >= 1) must stay "failed".
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewFinalStatus, unmountBeaconStatus, SUBSTANTIVE_TURNS } from "./finalize-status.ts";

test("a live call with real candidate turns and no error is completed", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 8, candidateTurnCount: 8 }),
    "completed",
  );
});

test("voice-interview #1: a silent-mic call (only the AI spoke) is failed, not completed", () => {
  // The interviewer's opening greeting makes turnCount === 1, but the candidate
  // never spoke — candidateTurnCount 0. Pre-fix this finalized "completed" (locked
  // out, billed, scored on zero candidate words); it must be "failed".
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 1, candidateTurnCount: 0 }),
    "failed",
  );
  // Even a chatty interviewer (several AI turns) with a silent candidate stays failed.
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 10, candidateTurnCount: 0 }),
    "failed",
  );
});

test("a SHORT error blip (below threshold) forces failed — the strict-rule case", () => {
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: SUBSTANTIVE_TURNS - 1, candidateTurnCount: SUBSTANTIVE_TURNS - 1 }),
    "failed",
  );
});

test("#2: a late error on a substantive call is completed (was 'failed' pre-fix)", () => {
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: SUBSTANTIVE_TURNS, candidateTurnCount: SUBSTANTIVE_TURNS }),
    "completed",
  );
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: 20, candidateTurnCount: 20 }),
    "completed",
  );
});

test("a disconnect before the call ever went live is failed", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: false, turnCount: 0, candidateTurnCount: 0 }),
    "failed",
  );
});

test("a live call that produced zero candidate turns is failed (nothing to score)", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 0, candidateTurnCount: 0 }),
    "failed",
  );
});

test("an errored connect that never went live is failed regardless of turn count", () => {
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: false, turnCount: 0, candidateTurnCount: 0 }),
    "failed",
  );
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: false, turnCount: 20, candidateTurnCount: 20 }),
    "failed",
  );
});

test("truth table: needs a live call, a candidate turn, and (below threshold) no error", () => {
  for (const errored of [false, true]) {
    for (const reachedLive of [false, true]) {
      for (const turnCount of [0, 3, SUBSTANTIVE_TURNS, 20]) {
        for (const candidateTurnCount of [0, turnCount]) {
          const hadRealConversation = reachedLive && candidateTurnCount > 0;
          const expected =
            hadRealConversation && !(errored && turnCount < SUBSTANTIVE_TURNS) ? "completed" : "failed";
          assert.equal(
            interviewFinalStatus({ errored, reachedLive, turnCount, candidateTurnCount }),
            expected,
            `errored=${errored} reachedLive=${reachedLive} turnCount=${turnCount} candidateTurnCount=${candidateTurnCount}`,
          );
        }
      }
    }
  }
});

// bug-ui-scan-2026-07-09 (voice-interview #5): the unmount/unload beacon.
test("#5: an End in flight beacons the real verdict for a substantive live call", () => {
  assert.equal(
    unmountBeaconStatus(true, { errored: false, reachedLive: true, turnCount: 8, candidateTurnCount: 8 }),
    "completed",
  );
});

test("#5: a true abandonment (no End in flight) stays conservatively failed", () => {
  assert.equal(
    unmountBeaconStatus(false, { errored: false, reachedLive: true, turnCount: 20, candidateTurnCount: 20 }),
    "failed",
  );
});
