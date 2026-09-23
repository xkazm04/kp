// challenge-r09 voice-provider-io/B, case 3: a mint failure is BORN TYPED.
//
// The adapters used to throw plain Errors with the HTTP status buried in English
// ("OpenAI client_secrets 401: ..."), so anything that wanted to tell a bad key from a
// dead self-hosted service would have had to regex the message. Now each adapter throws
// VoiceMintError { provider, cause, status? } with the SAME message text, so the
// connect route's safeJsonError log line is unchanged in either direction, and
// connectWithFailover (which catches anything) fails over exactly as before.
//
// Keyless: `fetch` is stubbed; nothing here reaches a provider.
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAiVoiceAdapter } from "./openai.ts";
import { ElevenLabsVoiceAdapter } from "./elevenlabs.ts";
import { VoiceMintError, mintCauseFromStatus } from "./mint-error.ts";
import { connectWithFailover } from "./connect-failover.ts";

const saved = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const k of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_BASE_URL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function stubFetch(impl: (url: string) => Promise<Response>) {
  mock.method(globalThis, "fetch", async (url: unknown) => impl(String(url)));
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  assert.fail("expected the mint to reject");
}

test("OpenAI 401 rejects with VoiceMintError auth/401, message unchanged", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  stubFetch(async () => json(401, { error: "bad key" }));
  const err = await rejection(new OpenAiVoiceAdapter().connect({ instructions: "probe" }));
  assert.ok(err instanceof VoiceMintError, "a typed mint failure");
  assert.equal(err.provider, "openai");
  assert.equal(err.cause, "auth");
  assert.equal(err.status, 401);
  assert.ok(err.message.startsWith("OpenAI client_secrets 401:"), err.message);
});

test("ElevenLabs 404 is not_found; the host-naming message is unchanged", async () => {
  process.env.ELEVENLABS_API_KEY = "xi";
  process.env.ELEVENLABS_AGENT_ID = "agent-x";
  stubFetch(async () => new Response("no agent", { status: 404 }));
  const err = await rejection(new ElevenLabsVoiceAdapter().connect());
  assert.ok(err instanceof VoiceMintError);
  assert.equal(err.provider, "elevenlabs");
  assert.equal(err.cause, "not_found");
  assert.equal(err.status, 404);
  assert.match(err.message, /get-signed-url responded 404: no agent/);
});

test("an AbortSignal TimeoutError is 'timeout'; a fetch TypeError (connection refused) is 'unreachable'", async () => {
  process.env.ELEVENLABS_API_KEY = "local";
  process.env.ELEVENLABS_AGENT_ID = "local-interviewer";
  process.env.ELEVENLABS_BASE_URL = "http://127.0.0.1:8080";
  stubFetch(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const timeout = await rejection(new ElevenLabsVoiceAdapter().connect());
  assert.ok(timeout instanceof VoiceMintError);
  assert.equal(timeout.cause, "timeout");
  assert.equal(timeout.message, "The operation was aborted due to timeout");

  mock.restoreAll();
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const refused = await rejection(new ElevenLabsVoiceAdapter().connect());
  assert.ok(refused instanceof VoiceMintError);
  assert.equal(refused.cause, "unreachable");
  assert.equal(refused.message, "fetch failed");
  assert.equal(refused.status, undefined);
});

test("a 200 with no signed_url, or a secret with an unusable expiry, is 'malformed'", async () => {
  process.env.ELEVENLABS_API_KEY = "xi";
  process.env.ELEVENLABS_AGENT_ID = "agent-x";
  stubFetch(async () => json(200, {}));
  const noUrl = await rejection(new ElevenLabsVoiceAdapter().connect());
  assert.ok(noUrl instanceof VoiceMintError);
  assert.equal(noUrl.cause, "malformed");
  assert.equal(noUrl.message, "ElevenLabs did not return a signed_url");

  mock.restoreAll();
  process.env.OPENAI_API_KEY = "sk-test";
  stubFetch(async () => json(200, { value: "ek_x", expires_at: 1 }));
  const expired = await rejection(new OpenAiVoiceAdapter().connect({ instructions: "probe" }));
  assert.ok(expired instanceof VoiceMintError);
  assert.equal(expired.cause, "malformed");
  assert.match(expired.message, /^OpenAI returned a client secret with no usable expiry/);
});

test("status classification: 401/403 auth, 404 not_found, 408 timeout, the rest upstream", () => {
  assert.equal(mintCauseFromStatus(401), "auth");
  assert.equal(mintCauseFromStatus(403), "auth");
  assert.equal(mintCauseFromStatus(404), "not_found");
  assert.equal(mintCauseFromStatus(408), "timeout");
  assert.equal(mintCauseFromStatus(429), "upstream");
  assert.equal(mintCauseFromStatus(500), "upstream");
});

test("connectWithFailover still fails over on a typed mint failure", async () => {
  const calls: string[] = [];
  const result = await connectWithFailover({
    preferred: "elevenlabs",
    availability: { openai: true, elevenlabs: true },
    isFree: () => false,
    instructions: "x",
    language: null,
    resolveAgentPrompt: () => null,
    getAdapter: (id) => ({
      connect: async () => {
        calls.push(id);
        if (id === "elevenlabs") throw new VoiceMintError({ provider: id, cause: "not_found", status: 404, message: "404" });
        return { provider: "openai", model: "m", clientSecret: "s", callsUrl: "u" };
      },
    }),
  });
  assert.equal(result.failedOver, true);
  assert.deepEqual(calls, ["elevenlabs", "openai"]);
});
