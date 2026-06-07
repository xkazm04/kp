// Locks the provider env-config contract that used to live in the /connect
// route (idea-c9349389). The route once re-encoded which vars each provider
// needs — `need = provider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY
// and ELEVENLABS_AGENT_ID"` — duplicating knowledge already inside each adapter.
// That knowledge now lives in one place: each adapter's `requiredEnv`, with
// missingVoiceEnv() and available() both deriving from it. These tests pin that
// single-source contract so a renamed/added var can't drift the check out of
// lockstep with the not-configured message again.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingVoiceEnv, type VoiceAdapter } from "./types.ts";
import { OpenAiVoiceAdapter } from "./openai.ts";
import { ElevenLabsVoiceAdapter } from "./elevenlabs.ts";

// Run `fn` with the given env vars cleared, restoring whatever was there before.
// The adapters read process.env live, so the suite must not depend on the
// machine's real keys being set or unset.
function withClearedEnv(names: readonly string[], fn: () => void) {
  const saved = new Map(names.map((n) => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  try {
    fn();
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// missingVoiceEnv — reports exactly the unset vars from the adapter's own list
// ---------------------------------------------------------------------------

test("missingVoiceEnv lists every requiredEnv var when none are set", () => {
  const fake: VoiceAdapter = {
    id: "openai",
    requiredEnv: ["__VOICE_TEST_A", "__VOICE_TEST_B"],
    available: () => false,
    connect: () => Promise.reject(new Error("unused")),
  };
  withClearedEnv(fake.requiredEnv, () => {
    assert.deepEqual(missingVoiceEnv(fake), ["__VOICE_TEST_A", "__VOICE_TEST_B"]);
  });
});

test("missingVoiceEnv reports only the subset that is actually unset", () => {
  const fake: VoiceAdapter = {
    id: "openai",
    requiredEnv: ["__VOICE_TEST_A", "__VOICE_TEST_B"],
    available: () => false,
    connect: () => Promise.reject(new Error("unused")),
  };
  withClearedEnv(fake.requiredEnv, () => {
    process.env.__VOICE_TEST_A = "present";
    assert.deepEqual(missingVoiceEnv(fake), ["__VOICE_TEST_B"]);
  });
});

test("missingVoiceEnv is empty once every requiredEnv var is set", () => {
  const fake: VoiceAdapter = {
    id: "openai",
    requiredEnv: ["__VOICE_TEST_A", "__VOICE_TEST_B"],
    available: () => true,
    connect: () => Promise.reject(new Error("unused")),
  };
  withClearedEnv(fake.requiredEnv, () => {
    process.env.__VOICE_TEST_A = "x";
    process.env.__VOICE_TEST_B = "y";
    assert.deepEqual(missingVoiceEnv(fake), []);
  });
});

// ---------------------------------------------------------------------------
// available() ⇔ missingVoiceEnv — the check can never drift from the message
// ---------------------------------------------------------------------------

test("each adapter's available() is true exactly when nothing is missing", () => {
  for (const adapter of [new OpenAiVoiceAdapter(), new ElevenLabsVoiceAdapter()] as VoiceAdapter[]) {
    withClearedEnv(adapter.requiredEnv, () => {
      // All unset → unavailable, and missing == the full required list.
      assert.equal(adapter.available(), false);
      assert.deepEqual(missingVoiceEnv(adapter), [...adapter.requiredEnv]);

      // All set → available, and nothing missing.
      for (const n of adapter.requiredEnv) process.env[n] = "configured";
      assert.equal(adapter.available(), true);
      assert.deepEqual(missingVoiceEnv(adapter), []);
    });
  }
});

// ---------------------------------------------------------------------------
// The not-configured message — adapter-driven names reproduce the old strings
// ---------------------------------------------------------------------------

test("the connect route's `need` phrase is sourced from the adapter, unchanged", () => {
  const openai = new OpenAiVoiceAdapter();
  const eleven = new ElevenLabsVoiceAdapter();
  withClearedEnv([...openai.requiredEnv, ...eleven.requiredEnv], () => {
    // This join is exactly what app/api/interview/connect/route.ts builds; it
    // must still yield the human-facing strings the route used to hardcode.
    assert.equal(missingVoiceEnv(openai).join(" and "), "OPENAI_API_KEY");
    assert.equal(
      missingVoiceEnv(eleven).join(" and "),
      "ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID",
    );
  });
});
