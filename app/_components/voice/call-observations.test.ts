// The observation arithmetic and the client hard stop (spark ai-interview-parity).
//
// These numbers reach a recruiter's evidence view, so the rule that matters most is
// the one about ABSENCE: a provider that does not expose an event yields null, never
// a zero. A zero pre-silence reads as "answered instantly" — a claim about the
// candidate made by a gap in the SDK.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_HARD_STOP_CEILING_FACTOR,
  CLIENT_HARD_STOP_GRACE_MIN,
  END_MAX_WAIT_MS,
  END_QUIET_MS,
  END_START_GRACE_MS,
  HARD_STOP_MIN_EXTENSION_MS,
  answerTiming,
  asDirectorClock,
  awayMs,
  endHandshakeDone,
  extendedHardStopDeadline,
  focusDuring,
  hardStopDelayMs,
} from "./call-observations.ts";
import { END_GRACE_MIN, MUST_ASK_CEILING_FACTOR } from "@/app/_lib/voice/director.ts";

test("the client hard stop uses the SAME grace and the SAME ceiling as the server's director", () => {
  // The client stop exists for the case the server cannot be reached. If the two
  // graces disagreed, a reachable director and an unreachable one would end the same
  // call minutes apart.
  assert.equal(CLIENT_HARD_STOP_GRACE_MIN, END_GRACE_MIN);
  assert.equal(CLIENT_HARD_STOP_CEILING_FACTOR, MUST_ASK_CEILING_FACTOR);
});

test("focus_lost names who held the floor; the interviewer wins a tie", () => {
  assert.equal(focusDuring({ interviewerSpeaking: true, candidateSpeaking: false }), "interviewer");
  assert.equal(focusDuring({ interviewerSpeaking: false, candidateSpeaking: true }), "candidate");
  assert.equal(focusDuring({ interviewerSpeaking: false, candidateSpeaking: false }), "idle");
  assert.equal(
    focusDuring({ interviewerSpeaking: true, candidateSpeaking: true }),
    "interviewer",
    "barge-in: what they were missing is the question being asked",
  );
});

test("awayMs never invents a duration", () => {
  assert.equal(awayMs(1_000, 4_500), 3500);
  assert.equal(awayMs(null, 4_500), 0, "no recorded departure is 0, not a guess");
  assert.equal(awayMs(9_000, 4_500), 0, "a clock that went backwards is 0, never negative");
});

test("answer timing: both numbers when both events exist", () => {
  assert.deepEqual(
    answerTiming({ interviewerAudioEndMs: 10_000, speechStartMs: 12_400, speechStopMs: 29_900 }),
    { preSilenceMs: 2400, durationMs: 17_500 },
  );
});

test("answer timing: a provider that exposes no stop event yields a NULL duration, not 0", () => {
  assert.deepEqual(
    answerTiming({ interviewerAudioEndMs: 10_000, speechStartMs: 12_000, speechStopMs: null }),
    { preSilenceMs: 2000, durationMs: null },
  );
});

test("answer timing: the first answer of a call has no interviewer end to measure from", () => {
  assert.deepEqual(
    answerTiming({ interviewerAudioEndMs: null, speechStartMs: 12_000, speechStopMs: 15_000 }),
    { preSilenceMs: null, durationMs: 3000 },
  );
});

test("answer timing: a barge-in is not a silence", () => {
  // The candidate started talking BEFORE the interviewer finished. A negative
  // "silence" would be recorded as fact about how fast they answered.
  assert.deepEqual(
    answerTiming({ interviewerAudioEndMs: 12_000, speechStartMs: 11_000, speechStopMs: 14_000 }),
    { preSilenceMs: null, durationMs: 3000 },
  );
});

test("answer timing: nothing measurable yields two nulls", () => {
  assert.deepEqual(answerTiming({ interviewerAudioEndMs: null, speechStartMs: null, speechStopMs: null }), {
    preSilenceMs: null,
    durationMs: null,
  });
});

test("hard stop: hardCap + grace, minus what earlier attempts already spent", () => {
  assert.equal(hardStopDelayMs({ hardCapMin: 30, priorElapsedSec: 0 }), 32 * 60_000);
  assert.equal(hardStopDelayMs({ hardCapMin: 30, priorElapsedSec: 600 }), 32 * 60_000 - 600_000);
});

test("hard stop: a call resumed past its cap stops immediately, never at a negative delay", () => {
  assert.equal(hardStopDelayMs({ hardCapMin: 30, priorElapsedSec: 40 * 60 }), 0);
});

test("hard stop: an UNDIRECTED call has no agenda and therefore no client cap", () => {
  // Today's behaviour for a session with nothing grounded to talk about: it runs
  // until the candidate, the provider or the server ends it.
  assert.equal(hardStopDelayMs({ hardCapMin: null, priorElapsedSec: 0 }), null);
  assert.equal(hardStopDelayMs({ hardCapMin: undefined, priorElapsedSec: 0 }), null);
  assert.equal(hardStopDelayMs({ hardCapMin: 0, priorElapsedSec: 0 }), null);
  assert.equal(hardStopDelayMs({ hardCapMin: Number.NaN, priorElapsedSec: 0 }), null);
});

test("hard stop: a nonsense prior elapsed is treated as none", () => {
  assert.equal(hardStopDelayMs({ hardCapMin: 10, priorElapsedSec: Number.NaN }), 12 * 60_000);
  assert.equal(hardStopDelayMs({ hardCapMin: 10, priorElapsedSec: -500 }), 12 * 60_000);
});

// ---- re-arming from the director's clock (spark interview-kit-template) ------------
//
// A 30-minute booking: hard cap 36, so the connect-time stop sits at 38 live minutes.
// A candidate who AGREED to the must-ask overrun moves the director's end limit to 60.

const MIN = 60_000;
const NOW = 1_000_000_000;
const BOOKED = { durationMin: 30, hardCapMin: 36 };
/** The connect-time arming for a call that connected at NOW − 20 min, no prior attempts. */
const ARMED = NOW - 20 * MIN + 38 * MIN;

test("re-arm: an agreed overrun EXTENDS the fallback stop to the director's new end limit", () => {
  const at = extendedHardStopDeadline({ armedAtMs: ARMED, clock: { elapsedMs: 20 * MIN, endLimitMs: 60 * MIN }, nowMs: NOW, agenda: BOOKED });
  assert.equal(at, NOW + 40 * MIN, "40 live minutes are left of 60");
});

test("re-arm: the connect-time arming is the FLOOR — a response never moves the stop earlier", () => {
  // Same limit as the arming (the ordinary hardCap + 2): nothing to do.
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock: { elapsedMs: 20 * MIN, endLimitMs: 38 * MIN }, nowMs: NOW, agenda: BOOKED }), null);
  // A server reading an EARLIER limit (a declined overrun, a skewed clock): the stop stays.
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock: { elapsedMs: 20 * MIN, endLimitMs: 30 * MIN }, nowMs: NOW, agenda: BOOKED }), null);
  // Already extended to 60, then a response reading 38 again: the extension stands.
  const extended = NOW + 40 * MIN;
  assert.equal(extendedHardStopDeadline({ armedAtMs: extended, clock: { elapsedMs: 21 * MIN, endLimitMs: 38 * MIN }, nowMs: NOW + MIN, agenda: BOOKED }), null);
});

test("re-arm: latency-sized moves re-arm nothing", () => {
  const tiny = { elapsedMs: 20 * MIN, endLimitMs: 38 * MIN + HARD_STOP_MIN_EXTENSION_MS - 1 };
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock: tiny, nowMs: NOW, agenda: BOOKED }), null);
  const enough = { elapsedMs: 20 * MIN, endLimitMs: 38 * MIN + HARD_STOP_MIN_EXTENSION_MS };
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock: enough, nowMs: NOW, agenda: BOOKED }), ARMED + HARD_STOP_MIN_EXTENSION_MS);
});

test("re-arm: never past what the booking allows, whatever the response says", () => {
  // max(36 + 2, 2 × 30) = 60 live minutes, however large the claimed limit.
  const at = extendedHardStopDeadline({ armedAtMs: ARMED, clock: { elapsedMs: 20 * MIN, endLimitMs: 600 * MIN }, nowMs: NOW, agenda: BOOKED });
  assert.equal(at, NOW + 40 * MIN);
  // A tiny booking keeps its grace: max(1 + 2, 2 × 1) = 3.
  const tinyAgenda = { durationMin: 1, hardCapMin: 1 };
  assert.equal(
    extendedHardStopDeadline({ armedAtMs: NOW, clock: { elapsedMs: 0, endLimitMs: 90 * MIN }, nowMs: NOW, agenda: tinyAgenda }),
    NOW + 3 * MIN,
  );
});

test("re-arm: past the limit already means stop now, never a negative delay", () => {
  assert.equal(extendedHardStopDeadline({ armedAtMs: NOW - 5 * MIN, clock: { elapsedMs: 70 * MIN, endLimitMs: 60 * MIN }, nowMs: NOW, agenda: BOOKED }), NOW);
});

test("re-arm: no armed stop, no clock or no agenda moves nothing", () => {
  const clock = { elapsedMs: 20 * MIN, endLimitMs: 60 * MIN };
  assert.equal(extendedHardStopDeadline({ armedAtMs: null, clock, nowMs: NOW, agenda: BOOKED }), null, "an undirected call is never armed by a response");
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock: null, nowMs: NOW, agenda: BOOKED }), null);
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock, nowMs: NOW, agenda: null }), null);
  assert.equal(extendedHardStopDeadline({ armedAtMs: ARMED, clock, nowMs: NOW, agenda: { durationMin: 0, hardCapMin: 36 } }), null);
});

test("asDirectorClock: two finite, non-negative numbers or no clock at all", () => {
  assert.deepEqual(asDirectorClock({ elapsedMs: 5, endLimitMs: 10, extra: "dropped" }), { elapsedMs: 5, endLimitMs: 10 });
  for (const bad of [null, undefined, "clock", 7, {}, { elapsedMs: 5 }, { elapsedMs: -1, endLimitMs: 10 }, { elapsedMs: 5, endLimitMs: Number.POSITIVE_INFINITY }, { elapsedMs: "5", endLimitMs: 10 }]) {
    assert.equal(asDirectorClock(bad), null, JSON.stringify(bad));
  }
});

// ---- the end-of-call handshake ---------------------------------------------
//
// `endCall` arrives in the SAME response that answers `end_interview`, so at that
// instant the model has not said its goodbye yet. The bug this shape prevents:
// ending on THAT silence, which hangs up a beat before "thanks for your time".

test("the goodbye is not cut off: silence before the closing line does not end the call", () => {
  assert.equal(
    endHandshakeDone({ elapsedMs: 300, quietMs: 300, spoke: false }),
    false,
    "quiet that has already lasted longer than END_QUIET_MS still means 'has not started yet'",
  );
  assert.equal(endHandshakeDone({ elapsedMs: 1500, quietMs: 1500, spoke: false }), false);
});

test("once the closing line has been heard, the call ends a beat after it stops", () => {
  assert.equal(endHandshakeDone({ elapsedMs: 5000, quietMs: null, spoke: true }), false, "still speaking");
  assert.equal(
    endHandshakeDone({ elapsedMs: 5000, quietMs: END_QUIET_MS - 1, spoke: true }),
    false,
    "a between-word gap is not the end of an utterance",
  );
  assert.equal(endHandshakeDone({ elapsedMs: 5000, quietMs: END_QUIET_MS, spoke: true }), true);
});

test("a closing line that never starts still ends the call, once its grace expires", () => {
  assert.equal(endHandshakeDone({ elapsedMs: END_START_GRACE_MS - 1, quietMs: 9999, spoke: false }), false);
  assert.equal(endHandshakeDone({ elapsedMs: END_START_GRACE_MS, quietMs: END_QUIET_MS, spoke: false }), true);
});

test("a speaking flag that never clears cannot hold a finished interview open", () => {
  // A stuck analyser, or a provider that stopped reporting: the hard bound wins
  // over every other condition.
  assert.equal(endHandshakeDone({ elapsedMs: END_MAX_WAIT_MS, quietMs: null, spoke: true }), true);
});
