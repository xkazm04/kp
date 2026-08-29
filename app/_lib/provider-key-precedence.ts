// Pure precedence logic for resolving ONE provider's API key on the TS side,
// following the repo's documented key layering (docs/architecture/llm-provider-layer.md,
// `buildLlmConfigEnv` in llm-config.ts):
//
//   UI-entered 'byom' row → 'platform' row → provider env var(s)
//
// 'byom' beats 'platform' for the same provider — the whole point of the BYOM
// tier is that the customer's key serves their traffic — and a stored row beats
// the deployment env var for the same reason. Kept dependency-free (rows,
// decrypt, and env are injected) so it is unit-testable under `node --test`,
// where the SQLite store isn't loadable; llm-config.ts wires the real DB +
// decryption around this.

export type ProviderKeyRowLike = {
  provider: string;
  scope: string;
  keyCiphertext: string;
};

export type ResolveProviderApiKeyOptions = {
  provider: string;
  rows: readonly ProviderKeyRowLike[];
  decrypt: (ciphertext: string) => string;
  /** Env lookup source (process.env in production; injected in tests). */
  env?: Record<string, string | undefined>;
  /** Env var fallbacks, first-set-wins (e.g. GEMINI_API_KEY → GOOGLE_API_KEY). */
  envVars?: readonly string[];
};

/**
 * Resolve a provider API key with the documented precedence. Returns undefined
 * only when NO row and no env var matched.
 *
 * A stored row that decrypts to the EMPTY STRING returns "" and stops there — it
 * does not fall through to the env var. That is deliberate and it is why this
 * function is not typed as "a key or undefined": since KEYLESS_PROVIDERS
 * (llm-model-defaults.ts) a row with a base URL and no key is a VALID, intended
 * configuration — a stock Ollama / llama.cpp / LM Studio server checks no
 * credential. Falling through would resurrect a deployment env credential the
 * operator deliberately configured away from, and send it to a server they chose
 * precisely because it needed none. Callers test truthiness (`if (!apiKey)`), so
 * "" and undefined read alike at the call site; only a caller comparing
 * `=== undefined` would be surprised, and there is none. Pinned by
 * provider-key-precedence.test.ts so the "obvious" fallthrough is not added later.
 *
 * This matches buildLlmConfigEnv, which omits an empty key from KP_LLM_CONFIG
 * rather than emitting "" — the same refusal to substitute a credential,
 * expressed in that builder's own idiom.
 *
 * A configured-but-undecryptable stored key fails LOUD (the decrypt error
 * propagates) rather than silently falling through to the platform/env key —
 * same reasoning: misattributing a customer's BYOM traffic to another key is
 * worse than failing.
 */
export function resolveProviderApiKey(options: ResolveProviderApiKeyOptions): string | undefined {
  const { provider, rows, decrypt, env = {}, envVars = [] } = options;
  for (const scope of ["byom", "platform"] as const) {
    const row = rows.find((candidate) => candidate.provider === provider && candidate.scope === scope);
    if (row) return decrypt(row.keyCiphertext);
  }
  for (const name of envVars) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}
