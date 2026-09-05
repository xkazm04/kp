// What a refused synthesis MEANS to the browser side.
//
// The hook itself needs a DOM; this pins the one decision inside it that does
// not — reading the host route's error body — because that decision is the whole
// of "the keyless failure reaches the operator in their language". Before it,
// `fetchChunk` threw `new Error(body.error)` and the code the route had already
// computed was dropped on the floor, so every surface had nothing to localize
// with and printed the route's English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TtsRequestError, ttsErrorFrom } from "./useTts.ts";

test("a coded refusal keeps BOTH halves: the code to resolve, the sentence to log", () => {
  const err = ttsErrorFrom({ error: "Could not speak that just now. Please try again.", code: "TTS_FAILED" }, 503);
  assert.ok(err instanceof TtsRequestError);
  assert.equal(err.code, "TTS_FAILED");
  assert.equal(err.message, "Could not speak that just now. Please try again.");
});

test("a host that answers no code still yields a usable sentence", () => {
  assert.equal(ttsErrorFrom({ error: "nope" }, 500).code, null);
  assert.equal(ttsErrorFrom({ error: "nope" }, 500).message, "nope");
});

test("an unreadable body falls back to the status line, never to empty text", () => {
  // The shape a proxy's HTML error page leaves behind: `res.json()` rejected and
  // the caller handed us `{}`. An empty `error` must not win over the status.
  for (const body of [{}, null, undefined, { error: "" }] as const) {
    const err = ttsErrorFrom(body, 502);
    assert.equal(err.message, "status 502");
    assert.equal(err.code, null);
  }
});

test("a null code on the wire is null here, not the string", () => {
  assert.equal(ttsErrorFrom({ error: "x", code: null }, 400).code, null);
});
