// The code -> status table of /api/tts, pinned by INVOKING the handler.
//
// Why it exists: every refusal on this route used to be an English sentence with
// no code, so a Czech operator whose synthesis was throttled read English and the
// client had nothing to branch on. The table below is the contract that replaced
// them, and a table nothing exercises is a table that drifts.
//
// Keyless by construction: every case here is refused BEFORE any engine is
// reached (the limiter and the body parse both run first), so this suite spends
// nothing, spawns nothing and needs no key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { POST } from "./route.ts";

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
