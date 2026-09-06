// The code -> status table of /api/tts, pinned by INVOKING the handler.
//
// Why it exists: every refusal on this route used to be an English sentence with
// no code, so a Czech operator whose synthesis was throttled read English and the
// client had nothing to branch on. The table below is the contract that replaced
// them, and a table nothing exercises is a table that drifts.
//
// Keyless by construction: every case here is refused BEFORE any engine is
// reached (a body that does not parse is refused on its own, and the limiter
// refuses the rest), so this suite spends nothing, spawns nothing and needs no
// key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { POST } from "./route.ts";
import { TTS_MAX_CHARS } from "@/packages/voice-tts/src/validate";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A distinct IP per case: the limiter is per-IP and in-process, so cases that
 *  share one would consume each other's budget and fail in test-order. */
function post(ip: string, body: BodyInit): Request {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body,
  });
}

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

test("a body that is not JSON is a coded 400, not an English sentence", async () => {
  const res = await POST(post("10.0.0.1", "not json at all"));
  assert.equal(res.status, 400);
  assert.equal(await codeOf(res), "VOICE_REQUEST_INVALID");
});

test("the per-IP throttle answers 429 through the refusal chokepoint", async () => {
  const ip = "10.0.0.2";
  // 60/10min. Every one of these is refused at the body parse, so the budget is
  // spent without a single synthesis.
  for (let i = 0; i < 60; i += 1) await POST(post(ip, "x"));
  const res = await POST(post(ip, "x"));
  assert.equal(res.status, 429);
  assert.equal(await codeOf(res), "TOO_MANY_REQUESTS");
  assert.equal(res.headers.get("retry-after"), null, "our own throttle does not claim to know how long");
});

test("the engine code table maps every member the package declares", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  // The branches that are NOT in the lookup, because they answer through the
  // refusal chokepoint instead.
  assert.match(src, /err\.code === "rate_limited"\) return engineThrottled\(err\.retryAfterMs\)/);
  // `unavailable` is a REFUSAL (its sentence is the information), so it never
  // reaches safeJsonError — but it still reads its status from the lookup, which
  // is why the `unavailable: 503` row below is live rather than dead code.
  assert.match(
    src,
    /err\.code === "unavailable"\) return jsonRefusal\("TTS_UNAVAILABLE", TTS_ERROR_STATUS\.unavailable\)/,
    "nothing-can-speak answers TTS_UNAVAILABLE at the lookup's status",
  );
  for (const [code, status] of [
    ["invalid_text", 400],
    ["invalid_voice", 400],
    ["unavailable", 503],
    ["timeout", 504],
  ] as const) {
    assert.match(src, new RegExp(`${code}: ${status},`), `${code} must map to ${status}`);
  }
  // Anything the package adds that this route has not heard of degrades to the
  // honest "the engine broke" rather than failing to compile.
  assert.match(src, /TTS_ERROR_STATUS\[err\.code\] \?\? 502/);
  // And the 500 is a store error with a code, never the thrown message.
  assert.match(src, /safeJsonError\(err, "api:tts", "TTS_FAILED"\)/);
});

// the-keyless-voice-failure-reaches-the-operator-in-their-language: the engine
// branch used to answer `{ error: err.message }` — "ELEVENLABS_API_KEY is not
// set", the provider's English 502 body — and the client reads `error`, so a
// Czech install printed an env var name in the Play button's tooltip. A SOURCE
// guard rather than an invocation: reaching the engine branch means reaching an
// engine, which is exactly what this keyless suite may not do.
test("an engine failure answers a registry code, never the engine's own sentence", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  assert.doesNotMatch(src, /error:\s*err\.message/, "the engine's sentence is a server-log fact, never a response body");
  assert.match(
    src,
    /safeJsonError\(err, "api:tts:engine", "TTS_FAILED", TTS_ERROR_STATUS\[err\.code\] \?\? 502\)/,
    "the engine branch answers through the chokepoint at the engine's own status",
  );
});

// the-cache-relieves-the-throttle. A SOURCE guard, for the same reason as the
// two above: proving the hit path by invoking POST would mean seeding the cache
// through an engine, which this keyless suite may not reach. The ORDER is the
// contract — and rate-limit-contract.test.ts pins the other half of it
// (`ttsCacheLookup(` must precede the limiter, `speakCached(` must follow it).
test("a replay is answered before the throttle is charged, and everything else pays", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8").replace(/\r\n/g, "\n");
  const lookupAt = src.indexOf("ttsCacheLookup(");
  const limiterAt = src.indexOf("rateLimit(`tts:${clientIpFrom(request.headers)}`, TTS_RATE_LIMIT)");
  const engineAt = src.indexOf("speakCached(getTts()");
  assert.ok(lookupAt > 0 && limiterAt > lookupAt, "the cache lookup must come before the limiter");
  assert.ok(engineAt > limiterAt, "the limiter must still guard the synthesis");
  // A MISS still pays, and so does a body that never parsed: the limiter is
  // skipped only when a replay was actually found.
  assert.match(src, /if \(!replay && !rateLimit\(/, "only a hit escapes the budget");
  // The pre-throttle body read is BOUNDED — an unbounded read in front of a
  // limiter is a door of its own.
  assert.match(src, /readJsonWithLimit<TtsBody \| null>\(request, MAX_TTS_BODY_BYTES, null\)/);
});

// the-wire-carries-voice-validity-and-format.
//
// Three defects, one wire: "pick another voice" and "try again" both answered
// TTS_FAILED so the surface could not tell them apart; `format` never left the
// browser, so the validation door's chat branch was unreachable over HTTP and
// the cache key's format slot was always empty; and the 1200-char bound fired
// only after the whole body had been parsed AND hashed into a cache key.
test("text over the package's own ceiling is refused before anything is hashed", async () => {
  const long = "a".repeat(TTS_MAX_CHARS + 1);
  const res = await POST(post("10.0.0.3", JSON.stringify({ text: long })));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string; maxChars?: number };
  assert.equal(body.code, "TTS_TEXT_TOO_LONG");
  assert.equal(body.maxChars, TTS_MAX_CHARS, "the reader's own sentence needs the number");
  // The guard imports the ceiling; a second copy of 1200 in this route is a
  // number that drifts away from the door that actually enforces it.
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  assert.match(src, /import \{ TTS_MAX_CHARS \}/);
  assert.doesNotMatch(src, /1200/);
  const guardAt = src.indexOf("TTS_TEXT_TOO_LONG");
  assert.ok(guardAt > 0 && guardAt < src.indexOf("ttsCacheLookup("), "the guard runs before the hash");
});

test("an unusable voice is its own refusal, not the generic engine failure", () => {
  // A SOURCE guard: reaching the invalid_voice branch means reaching an engine,
  // which this keyless suite may not do. The point is that it does NOT fall
  // through to TTS_FAILED, because "pick another voice" and "try again" are
  // different next moves and read identically today.
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  assert.match(
    src,
    /err\.code === "invalid_voice"\) return jsonRefusal\("TTS_VOICE_INVALID", TTS_ERROR_STATUS\.invalid_voice\)/,
  );
});

test("format rides the body into the validation door and the cache key", () => {
  const src = readFileSync(path.join(here, "route.ts"), "utf-8");
  assert.match(src, /format: body\.format === "chat" \? \("chat" as const\) : \("plain" as const\)/, "the route reads format off the wire");
  // `req` is what BOTH the cache key and the engine call receive, so reading it
  // once there is what puts format in the key and in front of speechReady.
  assert.match(src, /ttsCacheLookup\(req,/);
});
