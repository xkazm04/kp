// The voice plane's UI state machine — the one piece of intake voice state that
// used to live only in JdsIntakeVoice.tsx (phase + a single `error` boolean) and
// was therefore untestable. Everything here is pure: the component is the driver.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/library/jds/intake/voicePhase.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANGUP_DELAY_MS,
  apiFailure,
  initialVoiceUiState,
  micFailure,
  readAvailability,
  scheduleHangUp,
  voiceUiReducer,
  type VoiceUiState,
} from "./voicePhase.ts";

const live: VoiceUiState = { phase: "live", failure: null, awaitingMic: false, audioBlocked: false };

test("start moves idle → connecting and clears the previous failure", () => {
  const failed = voiceUiReducer(initialVoiceUiState, {
    type: "connectFailed",
    failure: { kind: "transport" },
  });
  assert.equal(failed.phase, "idle");
  assert.deepEqual(failed.failure, { kind: "transport" });
  const started = voiceUiReducer(failed, { type: "start" });
  assert.equal(started.phase, "connecting");
  assert.equal(started.failure, null);
});

test("start is ignored while a call is already up", () => {
  assert.equal(voiceUiReducer(live, { type: "start" }), live);
});

test("live only lands from connecting — never resurrects a closing call", () => {
  const connecting = voiceUiReducer(initialVoiceUiState, { type: "start" });
  assert.equal(voiceUiReducer(connecting, { type: "live" }).phase, "live");
  // close-during-processing: the transport's setLive can fire AFTER finish()
  // already moved the surface into the write-up phase.
  const processing = voiceUiReducer(live, { type: "finishing" });
  assert.equal(processing.phase, "processing");
  assert.equal(voiceUiReducer(processing, { type: "live" }).phase, "processing");
  assert.equal(voiceUiReducer(initialVoiceUiState, { type: "live" }).phase, "idle");
});

test("the mic hint only shows while a connect is actually in flight", () => {
  const connecting = voiceUiReducer(initialVoiceUiState, { type: "start" });
  assert.equal(voiceUiReducer(connecting, { type: "awaitingMic", value: true }).awaitingMic, true);
  // A late `false` from the transport's finally block after teardown must not
  // re-raise anything, and a stray `true` while idle stays down.
  assert.equal(voiceUiReducer(initialVoiceUiState, { type: "awaitingMic", value: true }).awaitingMic, false);
  const processing = voiceUiReducer(live, { type: "finishing" });
  assert.equal(voiceUiReducer(processing, { type: "awaitingMic", value: true }).awaitingMic, false);
});

test("a connect failure ends the call; a turn failure does not", () => {
  const connecting = voiceUiReducer(initialVoiceUiState, { type: "start" });
  const dead = voiceUiReducer(connecting, {
    type: "connectFailed",
    failure: { kind: "mic", reason: "denied" },
  });
  assert.equal(dead.phase, "idle");
  assert.deepEqual(dead.failure, { kind: "mic", reason: "denied" });
  assert.equal(dead.awaitingMic, false);

  const stumbled = voiceUiReducer(live, {
    type: "turnFailed",
    failure: { kind: "api", code: "TOO_MANY_REQUESTS", status: 429 },
  });
  assert.equal(stumbled.phase, "live");
  assert.deepEqual(stumbled.failure, { kind: "api", code: "TOO_MANY_REQUESTS", status: 429 });
});

test("finishing → processing → idle, and a write-up failure survives the close", () => {
  const processing = voiceUiReducer({ ...live, audioBlocked: true }, { type: "finishing" });
  assert.equal(processing.phase, "processing");
  assert.equal(processing.audioBlocked, false);
  const done = voiceUiReducer(processing, {
    type: "finished",
    failure: { kind: "api", code: "INTAKE_VOICE_COMPLETE_FAILED", status: 500 },
  });
  assert.equal(done.phase, "idle");
  assert.deepEqual(done.failure, { kind: "api", code: "INTAKE_VOICE_COMPLETE_FAILED", status: 500 });
  // A clean close keeps whatever was already on screen rather than inventing one.
  assert.equal(voiceUiReducer(processing, { type: "finished" }).failure, null);
  // Nothing to write up when no call was ever up.
  assert.equal(voiceUiReducer(initialVoiceUiState, { type: "finishing" }).phase, "idle");
});

test("audioBlocked is carried while live and dropped on close", () => {
  const blocked = voiceUiReducer(live, { type: "audioBlocked", value: true });
  assert.equal(blocked.audioBlocked, true);
  assert.equal(voiceUiReducer(blocked, { type: "finished" }).audioBlocked, false);
});

test("apiFailure reads the machine code, never the server's prose", () => {
  assert.deepEqual(apiFailure(429, { error: "Too many requests", code: "TOO_MANY_REQUESTS" }), {
    kind: "api",
    code: "TOO_MANY_REQUESTS",
    status: 429,
  });
  assert.deepEqual(apiFailure(502, null), { kind: "api", code: null, status: 502 });
  assert.deepEqual(apiFailure(500, { error: "boom" }), { kind: "api", code: null, status: 500 });
});

test("micFailure classifies a browser denial apart from a provider outage", () => {
  const denied = new DOMException("Permission denied", "NotAllowedError");
  assert.deepEqual(micFailure(denied), { kind: "mic", reason: "denied" });
  assert.deepEqual(micFailure(new DOMException("no device", "NotFoundError")), { kind: "mic", reason: "notFound" });
  assert.deepEqual(micFailure(new DOMException("in use", "NotReadableError")), { kind: "mic", reason: "busy" });
  assert.deepEqual(micFailure(new Error("OpenAI calls 500")), { kind: "transport" });
});

test("availability tells keyless apart from a read that did not land", () => {
  assert.equal(readAvailability(true, { availability: { openai: true } }), "ready");
  assert.equal(readAvailability(true, { availability: { openai: false } }), "unconfigured");
  assert.equal(readAvailability(true, {}), "unconfigured");
  // A 429 or a blip is NOT evidence the install is keyless.
  assert.equal(readAvailability(false, { code: "TOO_MANY_REQUESTS" }), "unknown");
});

test("the hang-up delay is cancellable — an unmount does not hang up later", () => {
  const fired: string[] = [];
  let seq = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers = {
    set: (fn: () => void, ms: number) => {
      const h = ++seq;
      pending.set(h, { fn, ms });
      return h;
    },
    clear: (h: unknown) => pending.delete(h as number),
  };

  const cancel = scheduleHangUp(() => fired.push("hangup"), timers);
  assert.equal(pending.get(1)?.ms, HANGUP_DELAY_MS);
  cancel();
  cancel(); // idempotent — the unmount effect may run beside an explicit close
  assert.equal(pending.size, 0);
  for (const { fn } of pending.values()) fn();
  assert.equal(fired.length, 0);

  const cancel2 = scheduleHangUp(() => fired.push("hangup"), timers);
  pending.get(2)!.fn();
  assert.equal(fired.join(","), "hangup");
  cancel2();
});
