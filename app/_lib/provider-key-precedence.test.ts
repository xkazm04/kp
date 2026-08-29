import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProviderApiKey, type ProviderKeyRowLike } from "./provider-key-precedence.ts";

// The documented key layering (docs/architecture/llm-provider-layer.md; buildLlmConfigEnv):
// UI-entered 'byom' row → 'platform' row → provider env var(s), first-set-wins.

const decrypt = (ciphertext: string) => ciphertext.replace(/^enc:/, "");

const row = (provider: string, scope: string, key: string): ProviderKeyRowLike => ({
  provider,
  scope,
  keyCiphertext: `enc:${key}`,
});

const GEMINI_ENV_VARS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

test("byom row beats platform row and env var", () => {
  const key = resolveProviderApiKey({
    provider: "gemini",
    rows: [row("gemini", "platform", "platform-key"), row("gemini", "byom", "byom-key")],
    decrypt,
    env: { GEMINI_API_KEY: "env-key" },
    envVars: GEMINI_ENV_VARS,
  });
  assert.equal(key, "byom-key");
});

test("platform row beats env var when no byom row exists", () => {
  const key = resolveProviderApiKey({
    provider: "gemini",
    rows: [row("gemini", "platform", "platform-key")],
    decrypt,
    env: { GEMINI_API_KEY: "env-key" },
    envVars: GEMINI_ENV_VARS,
  });
  assert.equal(key, "platform-key");
});

test("env fallback respects first-set-wins order (GEMINI_API_KEY before GOOGLE_API_KEY)", () => {
  const both = resolveProviderApiKey({
    provider: "gemini",
    rows: [],
    decrypt,
    env: { GEMINI_API_KEY: "gemini-env", GOOGLE_API_KEY: "google-env" },
    envVars: GEMINI_ENV_VARS,
  });
  assert.equal(both, "gemini-env");
  const googleOnly = resolveProviderApiKey({
    provider: "gemini",
    rows: [],
    decrypt,
    env: { GOOGLE_API_KEY: "google-env" },
    envVars: GEMINI_ENV_VARS,
  });
  assert.equal(googleOnly, "google-env");
});

test("another provider's rows never serve this provider", () => {
  const key = resolveProviderApiKey({
    provider: "gemini",
    rows: [row("openai", "byom", "openai-key")],
    decrypt,
    env: {},
    envVars: GEMINI_ENV_VARS,
  });
  assert.equal(key, undefined);
});

test("nothing configured resolves to undefined", () => {
  const key = resolveProviderApiKey({ provider: "gemini", rows: [], decrypt, env: {}, envVars: GEMINI_ENV_VARS });
  assert.equal(key, undefined);
});

test("a configured-but-undecryptable stored key fails loud instead of falling through", () => {
  assert.throws(
    () =>
      resolveProviderApiKey({
        provider: "gemini",
        rows: [row("gemini", "byom", "unused")],
        decrypt: () => {
          throw new Error("KP_SECRET is not set");
        },
        env: { GEMINI_API_KEY: "env-key" },
        envVars: GEMINI_ENV_VARS,
      }),
    /KP_SECRET/
  );
});

// KEYLESS_PROVIDERS (llm-model-defaults.ts) made "a stored row with a base URL and
// NO key" a valid, intended configuration — a stock Ollama / llama.cpp / LM Studio
// server checks no credential. This module predates that, and its contract sentence
// still said "or undefined when nothing is configured", which reads as an invitation
// to add an env fallthrough for the empty case.
//
// It must NOT fall through. The operator who stored a keyless row chose a server
// that needs no credential; resurrecting OLLAMA/OPENAI_API_KEY from the deployment
// env would send a credential to it anyway. buildLlmConfigEnv expresses the same
// refusal in its own idiom (it omits an empty key from KP_LLM_CONFIG rather than
// emitting ""), so this pins the two halves of one rule to the same answer.
test("a keyless stored row answers with the empty key and does NOT fall through to env", () => {
  const key = resolveProviderApiKey({
    provider: "ollama",
    rows: [row("ollama", "byom", "")],
    decrypt,
    env: { OLLAMA_API_KEY: "env-key-the-operator-configured-away-from" },
    envVars: ["OLLAMA_API_KEY"],
  });
  assert.equal(key, "", "the stored keyless row is the answer, not a miss to fall through");
  assert.notEqual(key, "env-key-the-operator-configured-away-from");
  // Callers test truthiness, so "" and undefined read alike at the call site —
  // which is what makes the no-fallthrough safe as well as correct.
  assert.equal(Boolean(key), false);

  // NON-VACUITY: with no row at all, the very same env DOES serve.
  assert.equal(
    resolveProviderApiKey({
      provider: "ollama",
      rows: [],
      decrypt,
      env: { OLLAMA_API_KEY: "env-key-the-operator-configured-away-from" },
      envVars: ["OLLAMA_API_KEY"],
    }),
    "env-key-the-operator-configured-away-from"
  );
});
