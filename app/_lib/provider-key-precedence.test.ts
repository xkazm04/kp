import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProviderApiKey, type ProviderKeyRowLike } from "./provider-key-precedence.ts";

// The documented key layering (docs/LLM_PROVIDER_LAYER.md; buildLlmConfigEnv):
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
