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
// a late error, while a short blip stays "failed". These tests pin both halves.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewFinalStatus, unmountBeaconStatus, SUBSTANTIVE_TURNS } from "./finalize-status.ts";

test("a live call with real turns and no error is completed", () => {
  assert.equal(
    interviewFinalStatus({ errored: false, reachedLive: true, turnCount: 8 }),
    "completed",
  );
});

test("a SHORT error blip (below threshold) forces failed — the strict-rule case", () => {
  // A 2-second connect flap that errored after only a couple turns is not a real,
  // scoreable interview; it stays "failed" and reconnectable.
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: SUBSTANTIVE_TURNS - 1 }),
    "failed",
  );
});

test("#2: a late error on a substantive call is completed (was 'failed' pre-fix)", () => {
  // The core bug: a fully-answered interview whose socket blipped at goodbye. The
  // captured transcript IS scoreable, so it must not be downgraded to "failed".
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: SUBSTANTIVE_TURNS }),
    "completed",
  );
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: true, turnCount: 20 }),
    "completed",
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

test("an errored connect that never went live is failed regardless of turn count", () => {
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: false, turnCount: 0 }),
    "failed",
  );
  assert.equal(
    interviewFinalStatus({ errored: true, reachedLive: false, turnCount: 20 }),
    "failed",
  );
});

test("truth table: error only matters below the substantive-turns threshold", () => {
  for (const errored of [false, true]) {
    for (const reachedLive of [false, true]) {
      for (const turnCount of [0, 3, SUBSTANTIVE_TURNS, 20]) {
        const hadRealConversation = reachedLive && turnCount > 0;
        const expected =
          hadRealConversation && !(errored && turnCount < SUBSTANTIVE_TURNS) ? "completed" : "failed";
        assert.equal(
          interviewFinalStatus({ errored, reachedLive, turnCount }),
          expected,
          `errored=${errored} reachedLive=${reachedLive} turnCount=${turnCount}`,
        );
      }
    }
  }
});

// bug-ui-scan-2026-07-09 (voice-interview #5): the unmount/unload beacon.
test("#5: an End in flight beacons the real verdict for a substantive live call", () => {
  // A cleanly-ended call whose End() was still in flight when the tab closed must
  // beacon "completed" (was hardcoded "failed" pre-fix, dropping its scorecard).
  assert.equal(
    unmountBeaconStatus(true, { errored: false, reachedLive: true, turnCount: 8 }),
    "completed",
  );
});

test("#5: a true abandonment (no End in flight) stays conservatively failed", () => {
  // A tab-close mid-interview, with no End clicked, must never be scored as passed —
  // even a fully substantive live transcript beacons "failed".
  assert.equal(
    unmountBeaconStatus(false, { errored: false, reachedLive: true, turnCount: 20 }),
    "failed",
  );
});
