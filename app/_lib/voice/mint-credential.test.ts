// What the browser is handed, and for how long.
//
// The ephemeral credential minted here goes to the CANDIDATE'S BROWSER over a
// public token route and is the one artifact in the interview flow that can
// spend money at the provider on its own. Before this suite it carried:
//   - no requested lifetime — whatever the provider defaulted to;
//   - no binding to the interview session it was minted for;
//   - an `expires_at` that was parsed into the response type and read by NOBODY,
//     so an already-expired secret was handed over and failed later, at the SDP
//     exchange, where it is indistinguishable from a network fault;
//   - no timeout on either provider mint, so a wedged provider (or a wedged
//     SELF-HOSTED voice service) held the route open long after the browser's
//     own 30s connect latch had fired on a session already flipped in_progress.
//
// Keyless: `fetch` is stubbed, so nothing here reaches a provider and no real
// API key is needed. Runner: node:test with type stripping (npm run test:unit).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  OPENAI_MINT_TIMEOUT_MS,
  OPENAI_SECRET_TTL_SEC,
  OpenAiVoiceAdapter,
  buildOpenAiSessionPayload,
  interviewSessionFingerprint,
  isMintedSecretUsable,
} from "./openai.ts";
import { ELEVENLABS_MINT_TIMEOUT_MS, ElevenLabsVoiceAdapter } from "./elevenlabs.ts";

const TOKEN = "iv_tok_2f6b8c1d9e4a7b30";
const BASE = {
  model: "gpt-realtime",
  instructions: "You are an interviewer.",
  transcriptionModel: "gpt-4o-transcribe",
  voice: "marin",
};

/** Run `fn` with env vars applied (undefined ⇒ cleared) and restore after. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = new Map(Object.keys(vars).map((n) => [n, process.env[n]]));
  for (const [n, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  try {
    await fn();
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

/** Stub global fetch with a scripted sequence of responses, capturing every call. */
function stubFetch(responses: { status: number; body: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const real = globalThis.fetch;
  mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  });
  return { calls, restore: () => (globalThis.fetch = real) };
}

const futureSecret = (secondsAhead = 120) =>
  JSON.stringify({ value: "ek_test_secret", expires_at: Math.floor(Date.now() / 1000) + secondsAhead });

// ── The payload builder ─────────────────────────────────────────────────────

test("the mint states its own credential lifetime instead of inheriting the provider default", () => {
  const payload = buildOpenAiSessionPayload({ ...BASE, expiresAfterSec: OPENAI_SECRET_TTL_SEC });
  assert.deepEqual(payload.expires_after, { anchor: "created_at", seconds: OPENAI_SECRET_TTL_SEC });
  // Long enough for a slow mobile handshake, far shorter than the client's own
  // 30s latch would need — a stolen secret is usable for about one dial.
  assert.ok(OPENAI_SECRET_TTL_SEC >= 60 && OPENAI_SECRET_TTL_SEC <= 300, "TTL must cover a dial, not a workday");
});

test("the credential is bound to ONE session — by fingerprint, never by the token itself", () => {
  const payload = buildOpenAiSessionPayload({ ...BASE, sessionToken: TOKEN });
  const meta = (payload.session as { metadata?: Record<string, string> }).metadata;
  assert.equal(meta?.kp_session, interviewSessionFingerprint(TOKEN));
  // The capability token opens the whole interview. It must not reach a third
  // party's dashboard or logs — so nothing serialized may contain it.
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(TOKEN), "the raw token must never leave this server");
  // A different session is a different fingerprint (so a mismatched credential
  // is identifiable), and the same session is stable.
  assert.notEqual(interviewSessionFingerprint(TOKEN), interviewSessionFingerprint(`${TOKEN}x`));
  assert.equal(interviewSessionFingerprint(TOKEN), interviewSessionFingerprint(TOKEN));
});

test("a tokenless (lab) mint sends no metadata and no lifetime it wasn't given", () => {
  const payload = buildOpenAiSessionPayload({ ...BASE });
  assert.equal((payload.session as { metadata?: unknown }).metadata, undefined);
  assert.equal(payload.expires_after, undefined);
});

test("the language/relay payload contract is untouched by the binding fields", () => {
  const payload = buildOpenAiSessionPayload({ ...BASE, language: "cs-CZ", relay: true, sessionToken: TOKEN });
  const audio = (payload.session as { audio: { input: Record<string, unknown> } }).audio;
  assert.equal((audio.input.transcription as { language?: string }).language, "cs");
  assert.deepEqual(audio.input.turn_detection, { type: "server_vad", create_response: false, interrupt_response: true });
});

// ── Expiry enforcement ──────────────────────────────────────────────────────

test("an expiry that is absent, malformed or already past is NOT usable", () => {
  const now = 1_800_000_000_000;
  assert.equal(isMintedSecretUsable(undefined, now), false, "absent is a failure, not a pass");
  assert.equal(isMintedSecretUsable(null, now), false);
  assert.equal(isMintedSecretUsable("1800000600", now), false, "a string is not an enforced expiry");
  assert.equal(isMintedSecretUsable(NaN, now), false);
  assert.equal(isMintedSecretUsable(now / 1000 - 1, now), false, "already past");
  assert.equal(isMintedSecretUsable(now / 1000 + 60, now), true);
});

test("a minted secret with no usable expiry is refused rather than handed to the browser", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const f = stubFetch([{ status: 200, body: JSON.stringify({ value: "ek_no_expiry" }) }]);
    try {
      await assert.rejects(
        () => new OpenAiVoiceAdapter().connect({ instructions: "hi", sessionToken: TOKEN }),
        /no usable expiry/,
        "an unbounded credential must not reach the candidate's browser"
      );
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
});

test("an already-expired secret is refused at the mint, not later at the SDP exchange", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const f = stubFetch([{ status: 200, body: futureSecret(-30) }]);
    try {
      await assert.rejects(() => new OpenAiVoiceAdapter().connect({ instructions: "hi" }), /no usable expiry/);
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
});

// ── Timeouts ────────────────────────────────────────────────────────────────

test("the OpenAI mint carries an abort signal and the requested lifetime", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const f = stubFetch([{ status: 200, body: futureSecret() }]);
    try {
      const conn = await new OpenAiVoiceAdapter().connect({ instructions: "hi", sessionToken: TOKEN });
      assert.equal(conn.provider, "openai");
      assert.equal(f.calls.length, 1);
      assert.ok(f.calls[0].init.signal instanceof AbortSignal, "an unbounded mint outlives the client's latch");
      const body = JSON.parse(String(f.calls[0].init.body));
      assert.equal(body.expires_after.seconds, OPENAI_SECRET_TTL_SEC);
      assert.equal(body.session.metadata.kp_session, interviewSessionFingerprint(TOKEN));
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
  assert.ok(OPENAI_MINT_TIMEOUT_MS > 0 && OPENAI_MINT_TIMEOUT_MS < 30_000, "must fire inside the client's 30s latch");
});

test("the ElevenLabs signed-url mint carries an abort signal", async () => {
  await withEnv({ ELEVENLABS_API_KEY: "el-test", ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_BASE_URL: undefined }, async () => {
    const f = stubFetch([{ status: 200, body: JSON.stringify({ signed_url: "wss://example/x" }) }]);
    try {
      const conn = await new ElevenLabsVoiceAdapter().connect();
      assert.equal(conn.provider, "elevenlabs");
      assert.ok(f.calls[0].init.signal instanceof AbortSignal, "a wedged self-hosted service must not hold the route");
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
  assert.ok(ELEVENLABS_MINT_TIMEOUT_MS > 0 && ELEVENLABS_MINT_TIMEOUT_MS < 30_000);
});

// ── The metadata fallback ───────────────────────────────────────────────────

test("a provider that rejects session metadata gets ONE retry without it, not a failed interview", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const f = stubFetch([
      { status: 400, body: JSON.stringify({ error: { message: "Unknown parameter: 'session.metadata'." } }) },
      { status: 200, body: futureSecret() },
    ]);
    try {
      const conn = await new OpenAiVoiceAdapter().connect({ instructions: "hi", sessionToken: TOKEN });
      assert.equal(conn.provider, "openai");
      assert.equal(f.calls.length, 2, "exactly one retry");
      assert.equal(JSON.parse(String(f.calls[1].init.body)).session.metadata, undefined);
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
});

test("any other 4xx keeps its original failure — the retry is not a general-purpose retry", async () => {
  await withEnv({ OPENAI_API_KEY: "sk-test" }, async () => {
    const f = stubFetch([{ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key provided" } }) }]);
    try {
      await assert.rejects(
        () => new OpenAiVoiceAdapter().connect({ instructions: "hi", sessionToken: TOKEN }),
        /client_secrets 401/
      );
      assert.equal(f.calls.length, 1, "an auth failure must not be re-spent as a second mint");
    } finally {
      f.restore();
      mock.restoreAll();
    }
  });
});
