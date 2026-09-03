// `buildProviderKeyProbeEnv` exists to answer ONE question honestly: "is the key
// stored on this (provider, scope) row any good?" The whole guarantee is what it
// LEAVES OUT — no routing table, and no other row's key — because the routing
// layering (byom → platform → env) would otherwise let a green "Test" on the
// platform row be produced by the BYOM key that outranks it, proving a credential
// the operator never asked about. That guarantee was only ever stated in a comment.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { buildProviderKeyProbeEnv } from "./llm-config.ts";
import { upsertProviderKey } from "./db/llm.ts";
import { encryptProviderSecret } from "./llm-secret.ts";

process.env.KP_SECRET = process.env.KP_SECRET || "probe-env-test-secret";

after(() => cleanupUnitDb());

type ProbeConfig = { useCases: Record<string, unknown>; keys: Record<string, { apiKey?: string; baseUrl?: string; endpoint?: string }> };

function probe(provider: string, scope: string): ProbeConfig | null {
  const env = buildProviderKeyProbeEnv(provider, scope);
  if (!env) return null;
  const keys = Object.keys(env);
  assert.deepEqual(keys, ["KP_LLM_CONFIG"], "the probe hands the child ONE variable");
  return JSON.parse(env.KP_LLM_CONFIG) as ProbeConfig;
}

test("a row that does not exist yields null — nothing is spawned for it", () => {
  assert.equal(buildProviderKeyProbeEnv("openai", "platform"), null);
});

test("the probe carries the asked-for row ONLY, with no routing at all", () => {
  upsertProviderKey({ provider: "openai", scope: "byom", keyCiphertext: encryptProviderSecret("sk-byom") });
  upsertProviderKey({ provider: "openai", scope: "platform", keyCiphertext: encryptProviderSecret("sk-platform") });
  upsertProviderKey({ provider: "gemini", scope: "byom", keyCiphertext: encryptProviderSecret("gm-key") });

  const platform = probe("openai", "platform");
  assert.ok(platform);
  assert.deepEqual(platform.useCases, {}, "no routing table — a probe must not be answerable by a pin");
  assert.deepEqual(Object.keys(platform.keys), ["openai"], "no other provider's key rides along");
  assert.equal(platform.keys.openai.apiKey, "sk-platform", "the row asked about, not the one that outranks it");

  // …and the BYOM row of the same provider is a different answer.
  assert.equal(probe("openai", "byom")?.keys.openai.apiKey, "sk-byom");
});

test("the probe hits the SAME server the real call would", () => {
  upsertProviderKey({
    provider: "openai",
    scope: "byom",
    keyCiphertext: encryptProviderSecret("sk-gateway"),
    meta: { baseUrl: "http://vllm.internal:8000/v1" },
  });
  // A green Test against the vendor cloud would prove nothing about the in-house
  // gateway the operator actually configured.
  assert.equal(probe("openai", "byom")?.keys.openai.baseUrl, "http://vllm.internal:8000/v1");
});
