// What a refused synthesis MEANS to the browser side.
//
// The hook itself needs a DOM; this pins the one decision inside it that does
// not — reading the host route's error body — because that decision is the whole
// of "the keyless failure reaches the operator in their language". Before it,
// `fetchChunk` threw `new Error(body.error)` and the code the route had already
// computed was dropped on the floor, so every surface had nothing to localize
// with and printed the route's English.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// the-tts-client-honors-the-wait-the-engine-asked-for. A 429 on chunk 3 of 6
// used to truncate the utterance mid-sentence and an immediate manual retry hit
// the same closed window. The retry loop and the header reader are pure and
// exported for exactly this: the decision is testable with a scripted fetch and
// a fake clock, with no DOM and no timers.
import {
  fetchHonoringRetryAfter,
  retryWaitMs,
  TTS_RETRY_ATTEMPTS,
  TTS_RETRY_MAX_WAIT_MS,
} from "./useTts.ts";

test("Retry-After is read as delta-seconds and as an HTTP-date", () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);
  assert.equal(retryWaitMs("2", now), 2000);
  assert.equal(retryWaitMs(" 2 ", now), 2000);
  assert.equal(retryWaitMs(new Date(now + 3000).toUTCString(), now), 3000);
  // A window that is already open is a zero wait, not a refusal to retry.
  assert.equal(retryWaitMs("0", now), 0);
  assert.equal(retryWaitMs(new Date(now - 5000).toUTCString(), now), 0);
});

test("a wait we cannot read, or one longer than an utterance can hold, is not honored", () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);
  for (const bad of [null, undefined, "", "   ", "soon", "-5"]) {
    assert.equal(retryWaitMs(bad, now), null, `${String(bad)} must not become a wait`);
  }
  // Over the ceiling we do NOT retry at the ceiling: waiting less than the
  // service asked for is hammering it, and holding an utterance for a minute is
  // worse than telling the operator it stopped.
  assert.equal(retryWaitMs(String(TTS_RETRY_MAX_WAIT_MS / 1000 + 1), now), null);
});

function scripted(statuses: Array<{ status: number; retryAfter?: string }>) {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    attempt: async () => {
      const spec = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      calls.push(spec.status);
      return new Response(null, {
        status: spec.status,
        headers: spec.retryAfter ? { "retry-after": spec.retryAfter } : {},
      });
    },
  };
}

test("a throttled chunk waits the asked-for time and then resumes the sequence", async () => {
  const s = scripted([{ status: 429, retryAfter: "2" }, { status: 200 }]);
  const waited: number[] = [];
  const marks: string[] = [];
  const res = await fetchHonoringRetryAfter(s.attempt, new AbortController().signal, {
    onWait: (ms) => marks.push(`wait:${ms}`),
    onResume: () => marks.push("resume"),
    sleep: async (ms) => void waited.push(ms),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(s.calls, [429, 200]);
  assert.deepEqual(waited, [2000]);
  assert.deepEqual(marks, ["wait:2000", "resume"]);
});

test("the retry is bounded: a service that keeps refusing is answered, not hammered", async () => {
  const s = scripted([{ status: 429, retryAfter: "1" }]);
  const res = await fetchHonoringRetryAfter(s.attempt, new AbortController().signal, { sleep: async () => {} });
  assert.equal(res.status, 429, "the last refusal is handed back for the caller to code");
  assert.equal(s.calls.length, TTS_RETRY_ATTEMPTS + 1);
});

test("a 429 with no wait, and every non-429, fails fast", async () => {
  for (const spec of [{ status: 429 }, { status: 400 }, { status: 503 }]) {
    const s = scripted([spec, { status: 200 }]);
    const res = await fetchHonoringRetryAfter(s.attempt, new AbortController().signal, { sleep: async () => {} });
    assert.equal(res.status, spec.status);
    assert.equal(s.calls.length, 1, `status ${spec.status} must not be retried`);
  }
});

test("stopping the utterance during the wait aborts it instead of resuming", async () => {
  const ctrl = new AbortController();
  const s = scripted([{ status: 429, retryAfter: "5" }, { status: 200 }]);
  ctrl.abort();
  await assert.rejects(
    () => fetchHonoringRetryAfter(s.attempt, ctrl.signal, {}),
    (e: Error) => e.name === "AbortError",
  );
  assert.equal(s.calls.length, 1, "the generation was stopped, so no second request is made");
});

// What `fetchChunk` puts on the wire and what it reads back off it. A SOURCE
// guard: the request lives inside the hook, which needs a DOM, and the two
// facts worth pinning are not behavioural branches but the presence of a field
// nothing was sending and a header nothing was reading.
test("the request carries format, and the answer's wrong-language header is kept", () => {
  const src = readFileSync(fileURLToPath(new URL("./useTts.ts", import.meta.url)), "utf-8");
  // `format` used to stay in the browser, so the host's validation door only
  // ever saw "plain" and every request shared one format slot in the cache key.
  assert.match(src, /format: args\.format \?\? "plain",/);
  // The clip played in the wrong language and the host said so; a header nothing
  // reads is a header that does not exist.
  assert.match(src, /unsupportedLanguage: res\.headers\.get\("x-tts-unsupported-language"\) \|\| null,/);
  assert.match(src, /unsupportedLanguage: chunk\.unsupportedLanguage,/, "and it reaches `served`, which is what a surface renders");
});
