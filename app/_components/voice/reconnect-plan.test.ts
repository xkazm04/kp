// A dropped directed call resumes itself: the record is saved first, then a
// cancellable redial (challenge-r08 voice-interview-components/B).
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTO_REDIAL_BUDGET,
  REDIAL_COUNTDOWN_SECONDS,
  isPermanentRefusal,
  reconnectPlan,
  saveStateOf,
  startPrecondition,
  type ReconnectInput,
} from "./reconnect-plan.ts";

const drop = (over: Partial<ReconnectInput> = {}): ReconnectInput => ({
  directed: true,
  ending: "drop",
  finalStatus: "failed",
  save: "saved",
  autoUsed: 0,
  online: true,
  cancelled: false,
  ...over,
});

test("directed drop with the record saved counts down to a redial", () => {
  assert.deepEqual(reconnectPlan(drop()), { kind: "countdown", seconds: 5 });
  assert.equal(REDIAL_COUNTDOWN_SECONDS, 5);
});

test("directed drop with the record NOT saved saves first, then counts down", () => {
  assert.deepEqual(reconnectPlan(drop({ save: "failed" })), { kind: "save_first" });
  // A save still in flight is the same wait: the session may still be in_progress.
  assert.deepEqual(reconnectPlan(drop({ save: "pending" })), { kind: "save_first" });
  assert.deepEqual(reconnectPlan(drop({ save: "saved" })), { kind: "countdown", seconds: 5 });
  // Saving first outranks the connectivity wait: nothing may dial over an unsaved session.
  assert.deepEqual(reconnectPlan(drop({ save: "failed", online: false })), { kind: "save_first" });
});

test("start never dials over its own unsaved session", () => {
  assert.deepEqual(startPrecondition({ prior: { sessionId: "s1", save: "failed" } }), {
    kind: "retry_save",
    sessionId: "s1",
  });
  assert.deepEqual(startPrecondition({ prior: null }), { kind: "dial" });
  assert.deepEqual(startPrecondition({ prior: { sessionId: "s1", save: "saved" } }), { kind: "dial" });
  // A save already in flight is waited for, never doubled.
  assert.deepEqual(startPrecondition({ prior: { sessionId: "s1", save: "pending" } }), { kind: "wait_save" });
  // A refused save has nothing left to settle; the server answers the dial itself.
  assert.deepEqual(startPrecondition({ prior: { sessionId: "s1", save: "refused" } }), { kind: "dial" });
});

test("a refused save means stop", () => {
  assert.deepEqual(reconnectPlan(drop({ save: "refused" })), { kind: "none" });
});

test("undirected or decided endings do not auto-dial", () => {
  assert.deepEqual(reconnectPlan(drop({ directed: false })), { kind: "manual" });
  assert.deepEqual(reconnectPlan(drop({ ending: "candidate_end" })), { kind: "none" });
  assert.deepEqual(reconnectPlan(drop({ ending: "director_end" })), { kind: "none" });
  assert.deepEqual(reconnectPlan(drop({ finalStatus: "completed" })), { kind: "none" });
  // A call that never went live has nothing to resume (a mic denial must not be redialled).
  assert.deepEqual(reconnectPlan(drop({ reachedLive: false })), { kind: "none" });
});

test("budget and connectivity", () => {
  assert.equal(AUTO_REDIAL_BUDGET, 2);
  assert.deepEqual(reconnectPlan(drop({ autoUsed: 1 })), { kind: "countdown", seconds: 5 });
  assert.deepEqual(reconnectPlan(drop({ autoUsed: 2 })), { kind: "manual", reason: "budget" });
  assert.deepEqual(reconnectPlan(drop({ autoUsed: 3 })), { kind: "manual", reason: "budget" });
  assert.deepEqual(reconnectPlan(drop({ online: false })), { kind: "wait_online" });
  assert.deepEqual(reconnectPlan(drop({ cancelled: true })), { kind: "manual", reason: "cancelled" });
});

test("persistence exposes a tri-state (plus pending), not a boolean", () => {
  assert.equal(saveStateOf({ saved: false, discardedTurns: 3, inFlight: false }), "refused");
  assert.equal(saveStateOf({ saved: false, discardedTurns: 0, inFlight: false }), "failed");
  assert.equal(saveStateOf({ saved: true, discardedTurns: 0, inFlight: false }), "saved");
  assert.equal(saveStateOf({ saved: false, discardedTurns: 0, inFlight: true }), "pending");
});

test("ANY permanent 4xx is a refusal, not only discardedTurns > 0", () => {
  for (const status of [400, 403, 404, 409, 413]) {
    assert.equal(isPermanentRefusal(status), true, `${status}`);
    assert.equal(
      saveStateOf({ saved: false, discardedTurns: 0, inFlight: false, refusedStatus: status }),
      "refused",
      `${status}`,
    );
  }
  // 429 is /complete's throttle and WILL improve; 5xx and a network error are transient.
  for (const status of [429, 500, 503, null]) {
    assert.equal(isPermanentRefusal(status), false, `${status}`);
    assert.equal(
      saveStateOf({ saved: false, discardedTurns: 0, inFlight: false, refusedStatus: status }),
      "failed",
      `${status}`,
    );
  }
});

test("the shell drives the plan from finalize's outcome and gates Start on the precondition", () => {
  const shell = readFileSync(fileURLToPath(new URL("./VoiceInterview.tsx", import.meta.url)), "utf8");
  assert.match(shell, /reconnectPlan\(/);
  assert.match(shell, /startPrecondition\(/);
  // The outcome is recorded inside finalize, which BOTH the OpenAI drop and the
  // ElevenLabs onDisconnect run through.
  const finalizeBody = shell.slice(shell.indexOf("const finalize = useCallback"), shell.indexOf("// M3: tick the elapsed"));
  assert.match(finalizeBody, /setOutcome\(/);
  // The old defect: start() cleared the failed-save flag before dialling, which
  // disarmed the re-drive and walked the candidate into INTERVIEW_ALREADY_LIVE.
  assert.doesNotMatch(shell, /setSaveFailed\(false\)/);
  // The one Retry banner reads the shared save state, not a second boolean.
  assert.match(shell, /saveState === "failed"/);
});
