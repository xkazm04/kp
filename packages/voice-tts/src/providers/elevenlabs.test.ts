// The cloud adapter's failure vocabulary. Every row here is a next action a
// surface has to be able to tell apart: wait (rate_limited), pick another voice
// (invalid_voice), fix the account (unavailable), retry or fall back
// (engine_failed). Before this table 401 was the only distinguished status and
// everything else — quota, a wrong voice id, a transient 5xx — arrived as one
// undifferentiated 502.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ElevenLabsTts } from "./elevenlabs.ts";
import { TtsError, type TtsErrorCode, type TtsHost } from "../types.ts";

const ENV: Record<string, string> = { ELEVENLABS_API_KEY: "k", ELEVENLABS_BASE_URL: "https://tts.test" };
const host: TtsHost = { env: (k) => ENV[k], homeDir: () => "/home/x", cwd: () => "/app" };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch double answering one status; `headers` ride on the response. */
function answer(status: number, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () =>
    new Response(status < 300 ? new Uint8Array(64) : "upstream detail", { status, headers })) as typeof fetch;
}

const ROWS: { status: number; code: TtsErrorCode; why: string }[] = [
  { status: 400, code: "engine_failed", why: "an unclassified client error is still the engine's problem to report" },
  { status: 401, code: "unavailable", why: "the key was rejected" },
  { status: 403, code: "unavailable", why: "the key is valid but not entitled" },
  { status: 404, code: "invalid_voice", why: "the voice id is the path segment" },
  { status: 422, code: "invalid_voice", why: "well-formed request, unusable voice/model" },
  { status: 429, code: "rate_limited", why: "busy, not broken" },
  { status: 500, code: "engine_failed", why: "service error" },
  { status: 503, code: "engine_failed", why: "service error" },
];

for (const row of ROWS) {
  test(`synthesize maps ${row.status} -> ${row.code} (${row.why})`, async () => {
    answer(row.status);
    const el = new ElevenLabsTts(host);
    await assert.rejects(
      el.synthesize({ text: "hello" }),
      (e: TtsError) => e instanceof TtsError && e.code === row.code && e.provider === "elevenlabs",
    );
  });
}

test("429 carries Retry-After as milliseconds; seconds and HTTP-date both parse", async () => {
  answer(429, { "retry-after": "12" });
  await assert.rejects(new ElevenLabsTts(host).synthesize({ text: "hi" }), (e: TtsError) => e.retryAfterMs === 12_000);

  answer(429, { "retry-after": new Date(Date.now() + 30_000).toUTCString() });
  await assert.rejects(
    new ElevenLabsTts(host).synthesize({ text: "hi" }),
    (e: TtsError) => typeof e.retryAfterMs === "number" && e.retryAfterMs > 20_000 && e.retryAfterMs <= 31_000,
  );
});

test("a missing, malformed or already-past Retry-After leaves the backoff to the host", async () => {
  for (const header of [undefined, "soon", "Thu, 01 Jan 1970 00:00:00 GMT"]) {
    answer(429, header === undefined ? {} : { "retry-after": header });
    await assert.rejects(
      new ElevenLabsTts(host).synthesize({ text: "hi" }),
      (e: TtsError) => e.code === "rate_limited" && e.retryAfterMs === undefined,
    );
  }
});

test("no key is `unavailable` before any request is spent", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  const bare = new ElevenLabsTts({ env: () => undefined, homeDir: () => "/h", cwd: () => "/a" });
  await assert.rejects(bare.synthesize({ text: "hi" }), (e: TtsError) => e.code === "unavailable");
  assert.equal(called, false);
});

test("a 429 keeps the cached ready probe; any other failure invalidates it", async () => {
  const probes: number[] = [];
  const el = new ElevenLabsTts(host);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/user")) {
      probes.push(1);
      return new Response("{}", { status: 200 });
    }
    return new Response("busy", { status: 429 });
  }) as typeof fetch;

  assert.deepEqual(await el.probe(), { state: "ready" });
  await assert.rejects(el.synthesize({ text: "hi" }), (e: TtsError) => e.code === "rate_limited");
  await el.probe();
  assert.equal(probes.length, 1, "429 must not invalidate a fresh probe");

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/user")) {
      probes.push(1);
      return new Response("{}", { status: 200 });
    }
    return new Response("nope", { status: 403 });
  }) as typeof fetch;
  await assert.rejects(el.synthesize({ text: "hi" }), (e: TtsError) => e.code === "unavailable");
  await el.probe();
  assert.equal(probes.length, 2, "a credentials failure must re-probe");
});
