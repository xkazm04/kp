// The pre-call mic test collapsed EVERY getUserMedia rejection to "denied" —
// `catch { setMicTest("denied") }` — although micErrorText, the classifier that
// names not-found and busy, sits in the same directory and is already used by both
// the interview shell and the intake voice surface. A candidate whose headset was
// unplugged, or whose mic was held by a still-open video call, was told to grant a
// permission they had already granted.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIC_TEST_DURATION_MS, MIC_HEARD_RMS, micLevelPercent, micTestFailure } from "./useMicTest.ts";

function domException(name: string, message = ""): unknown {
  const e = new Error(message);
  e.name = name;
  // node:test has no DOMException-producing browser API; micErrorText falls back to
  // the message/name test for non-DOMException values, which is the same table.
  return e;
}

test("a denied permission is denied", () => {
  assert.equal(micTestFailure(domException("NotAllowedError", "Permission denied")), "denied");
  assert.equal(micTestFailure(domException("SecurityError")), "denied");
});

test("no microphone is NOT a permission problem", () => {
  assert.equal(micTestFailure(domException("NotFoundError", "Requested device not found")), "not-found");
  assert.equal(micTestFailure(domException("OverconstrainedError", "device not found")), "not-found");
});

test("a microphone another app is holding is NOT a permission problem", () => {
  assert.equal(micTestFailure(domException("NotReadableError", "Device in use")), "busy");
  assert.equal(micTestFailure(domException("AbortError", "already in use")), "busy");
});

test("an unclassifiable rejection stays conservatively denied — the most common cause", () => {
  assert.equal(micTestFailure(new Error("something else entirely")), "denied");
  assert.equal(micTestFailure(null), "denied");
});

test("the level readout is a whole percent, clamped — the reduced-motion substitute for the bar", () => {
  assert.equal(micLevelPercent(0), 0);
  assert.equal(micLevelPercent(0.5), 50);
  assert.equal(micLevelPercent(1), 100);
  assert.equal(micLevelPercent(4), 100, "an over-unity rms must not render 400%");
  assert.equal(micLevelPercent(-1), 0);
});

test("the sampling window and heard threshold are named, not inline literals", () => {
  assert.equal(MIC_TEST_DURATION_MS, 4000);
  assert.ok(MIC_HEARD_RMS > 0 && MIC_HEARD_RMS < 1);
});
