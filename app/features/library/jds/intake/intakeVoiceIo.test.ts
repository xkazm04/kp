// The pure half of the intake composer's voice pair. No DOM, no packages — the
// hooks are wiring, and these are the rules the wiring must not get wrong.
//
//   node scripts/run-unit-tests.mjs app/features/library/jds/intake/intakeVoiceIo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_SPEAK,
  STT_UNAVAILABLE_CODE,
  TTS_UNAVAILABLE_CODE,
  appendDictation,
  latchUnavailable,
  parseAutoSpeak,
  shouldAutoSpeak,
  type AutoSpeakInput,
} from "./intakeVoiceIo.ts";

test("only the not-configured code latches, and it latches for good", () => {
  assert.equal(latchUnavailable(false, STT_UNAVAILABLE_CODE, STT_UNAVAILABLE_CODE), true);
  // Sticky: a later success (or a later unrelated failure) does not re-offer a
  // control whose fix is a server config.
  assert.equal(latchUnavailable(true, null, STT_UNAVAILABLE_CODE), true);
  assert.equal(latchUnavailable(true, "STT_FAILED", STT_UNAVAILABLE_CODE), true);
});

test("every other refusal leaves the control live", () => {
  for (const code of ["STT_FAILED", "STT_TOO_LONG", "TOO_MANY_REQUESTS", null, undefined]) {
    assert.equal(latchUnavailable(false, code, STT_UNAVAILABLE_CODE), false, `${code} must not latch`);
  }
});

test("the two pipelines latch independently — partial voice is a designed rung", () => {
  // A machine with whisper.cpp and no Piper: dictation keeps working.
  assert.equal(latchUnavailable(false, TTS_UNAVAILABLE_CODE, STT_UNAVAILABLE_CODE), false);
  assert.equal(latchUnavailable(false, TTS_UNAVAILABLE_CODE, TTS_UNAVAILABLE_CODE), true);
});

const base: AutoSpeakInput = { autoSpeak: true, visible: true, primed: true, lastSpoken: null, next: "Tell me about the role." };

test("auto-speak reads a new agent turn when it is on and the tab is visible", () => {
  assert.equal(shouldAutoSpeak(base), true);
});

test("the first evaluation of a mount is silent — a stored session is not an arrival", () => {
  assert.equal(shouldAutoSpeak({ ...base, primed: false }), false);
});

test("off, hidden, or nothing to say are each a no", () => {
  assert.equal(shouldAutoSpeak({ ...base, autoSpeak: false }), false);
  assert.equal(shouldAutoSpeak({ ...base, visible: false }), false);
  assert.equal(shouldAutoSpeak({ ...base, next: null }), false);
  assert.equal(shouldAutoSpeak({ ...base, next: "" }), false);
});

test("the same reply is spoken once, however many times it re-renders", () => {
  assert.equal(shouldAutoSpeak({ ...base, lastSpoken: base.next }), false);
  assert.equal(shouldAutoSpeak({ ...base, lastSpoken: "an older answer" }), true);
});

test("a transcript appends to the draft rather than replacing it", () => {
  assert.equal(appendDictation("We need a", "senior data engineer"), "We need a senior data engineer");
  assert.equal(appendDictation("", "senior data engineer"), "senior data engineer");
  assert.equal(appendDictation("   ", "senior data engineer"), "senior data engineer");
});

test("the join point does not leave punctuation for the requestor to fix", () => {
  // One space, never two, whatever trailing spaces the typing left behind.
  assert.equal(appendDictation("We need a  ", "senior engineer"), "We need a senior engineer");
  // A fragment that starts with closing punctuation joins tight.
  assert.equal(appendDictation("We need a senior engineer", ", ideally with Kafka"), "We need a senior engineer, ideally with Kafka");
  assert.equal(appendDictation("Two years", ". Prague based"), "Two years. Prague based");
});

test("a deliberate line break survives the append", () => {
  assert.equal(appendDictation("Must have:\n", "Kafka"), "Must have:\nKafka");
  assert.equal(appendDictation("Must have:\n\n", "Kafka"), "Must have:\n\nKafka");
});

test("an empty transcript changes nothing at all", () => {
  assert.equal(appendDictation("half a sentence", "   "), "half a sentence");
  assert.equal(appendDictation("half a sentence", ""), "half a sentence");
});

test("leading whitespace is the requestor's, not ours", () => {
  assert.equal(appendDictation("  indented", "text"), "  indented text");
});

test("the stored preference is total, and its default is off", () => {
  assert.equal(DEFAULT_AUTO_SPEAK, false);
  assert.equal(parseAutoSpeak("1"), true);
  assert.equal(parseAutoSpeak("true"), true);
  assert.equal(parseAutoSpeak("0"), false);
  assert.equal(parseAutoSpeak(null), false);
  assert.equal(parseAutoSpeak("{}"), false);
  assert.equal(parseAutoSpeak("yes please"), false);
});
