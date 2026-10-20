// The one derivation the presence orb, the status pill and the screen-reader line
// all read (spark ai-interview-parity).
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { presenceIsLive, presenceMeter, presenceState } from "./presence-state.ts";
import type { Phase } from "./ui-types.ts";

const at = (phase: Phase, interviewerSpeaking = false, thinking = false) =>
  presenceState({ phase, interviewerSpeaking, thinking });

test("the pre-call and post-call phases map straight through", () => {
  assert.equal(at("idle"), "idle");
  assert.equal(at("connecting"), "connecting");
  assert.equal(at("ended"), "ended");
  assert.equal(at("error"), "ended");
});

test("live is listening, thinking or speaking — speaking wins", () => {
  assert.equal(at("live"), "listening");
  assert.equal(at("live", false, true), "thinking");
  assert.equal(at("live", true, false), "speaking");
  assert.equal(at("live", true, true), "speaking", "audio is playing: it is no longer thinking");
});

test("ending keeps speaking while the closing line is still playing", () => {
  // Showing a dead orb while a voice is still talking is the small lie that makes a
  // call feel broken; endCall deliberately waits for the utterance to finish.
  assert.equal(at("ending", true), "speaking");
  assert.equal(at("ending", false), "ended");
});

test("only the two audio-driven states follow a meter, and each follows its own", () => {
  assert.equal(presenceIsLive("listening"), true);
  assert.equal(presenceIsLive("speaking"), true);
  for (const s of ["idle", "connecting", "thinking", "ended"] as const) {
    assert.equal(presenceIsLive(s), false, `${s} must not jitter`);
    assert.equal(presenceMeter(s), null);
  }
  assert.equal(presenceMeter("listening"), "input", "the candidate's microphone");
  assert.equal(presenceMeter("speaking"), "output", "the interviewer's audio");
});
