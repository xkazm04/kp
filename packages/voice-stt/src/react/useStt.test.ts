// The two decisions inside `useStt` that do not need a DOM, and that decide
// whether a recording is lost.
//
// `useStt` itself needs `navigator.mediaDevices`, `MediaRecorder` and a real
// `AudioContext`, none of which node:test has; what is asserted here is the
// state machine every one of those callbacks routes through, and the mapping
// from the host route's refusal body to something a person can read. Those are
// the parts that were going to be re-derived per surface and got the answer
// subtly wrong each time — a late `onstop` re-entering the upload path, a 499
// painted as an engine fault, a code dropped so every locale printed English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STT_PHASES, SttRequestError, sttBusy, sttErrorFrom, sttPhaseNext, type SttEvent, type SttPhase } from "./useStt.ts";

const EVENTS: SttEvent[] = ["press", "granted", "denied", "stop", "encoded", "transcribed", "failed", "cancel"];

test("the happy path walks idle -> requesting -> recording -> encoding -> transcribing -> idle", () => {
  let phase: SttPhase = "idle";
  for (const [event, expected] of [
    ["press", "requesting"],
    ["granted", "recording"],
    ["stop", "encoding"],
    ["encoded", "transcribing"],
    ["transcribed", "idle"],
  ] as const) {
    phase = sttPhaseNext(phase, event);
    assert.equal(phase, expected, `after ${event}`);
  }
});

test("a denied permission is an error, not a silent return to idle", () => {
  // Idle after a denial reads as "the mic did nothing"; the operator needs to be
  // told the browser refused, because the fix is in the browser.
  assert.equal(sttPhaseNext("requesting", "denied"), "error");
});

test("failure and cancel are answerable from EVERY phase, and land in one place", () => {
  for (const phase of STT_PHASES) {
    assert.equal(sttPhaseNext(phase, "failed"), "error", `failed from ${phase}`);
    assert.equal(sttPhaseNext(phase, "cancel"), "idle", `cancel from ${phase}`);
  }
});

test("a late stop after a failure does not re-enter the upload path", () => {
  // MediaRecorder.onstop arrives after the encode already threw. Treating stop
  // as universally meaning "encode now" would post a failed capture and paint
  // over the error the operator is reading.
  assert.equal(sttPhaseNext("error", "stop"), "error");
  assert.equal(sttPhaseNext("transcribing", "stop"), "transcribing");
  assert.equal(sttPhaseNext("encoding", "stop"), "encoding");
});

test("a second press mid-capture changes nothing, so one press cannot post twice", () => {
  for (const phase of ["requesting", "recording", "encoding", "transcribing"] as const) {
    assert.equal(sttPhaseNext(phase, "press"), phase, `press from ${phase}`);
  }
});

test("a press from error starts over, so a failed mic never needs a reload", () => {
  assert.equal(sttPhaseNext("error", "press"), "requesting");
});

test("every phase/event pair lands on a declared phase and never throws", () => {
  for (const phase of STT_PHASES) {
    for (const event of EVENTS) {
      const next = sttPhaseNext(phase, event);
      assert.ok(STT_PHASES.includes(next), `${phase} + ${event} -> ${next}`);
    }
  }
});

test("busy is exactly the phases where a new capture must not start", () => {
  // `recording` is NOT busy: a press there is the stop, which is the whole point
  // of a single toggling control.
  assert.deepEqual(
    STT_PHASES.filter(sttBusy),
    ["requesting", "encoding", "transcribing"],
  );
});

test("a coded refusal keeps BOTH halves: the code to resolve, the sentence to log", () => {
  const err = sttErrorFrom({ error: "Transcription is not configured on this server.", code: "STT_UNAVAILABLE" }, 503);
  assert.ok(err instanceof SttRequestError);
  assert.equal(err.code, "STT_UNAVAILABLE");
  assert.equal(err.message, "Transcription is not configured on this server.");
});

test("499 is the caller's own abort, and says so instead of naming a fault", () => {
  // The route answers 499 with an EMPTY body (app/api/stt/route.ts): there is no
  // `error` to read, and a mapper that fell through would produce "status 499"
  // with a null code, which every surface paints red.
  const err = sttErrorFrom(null, 499);
  assert.equal(err.code, "ABORTED");
  assert.equal(err.message, "aborted");
});

test("an unreadable body falls back to the status line, never to empty text", () => {
  for (const body of [{}, null, undefined, { error: "" }] as const) {
    const err = sttErrorFrom(body, 502);
    assert.equal(err.message, "status 502");
    assert.equal(err.code, null);
  }
});

test("a null code on the wire is null here, not the string", () => {
  assert.equal(sttErrorFrom({ error: "x", code: null }, 400).code, null);
});
