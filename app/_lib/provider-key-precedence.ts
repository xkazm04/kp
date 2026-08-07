// Pure precedence logic for resolving ONE provider's API key on the TS side,
// following the repo's documented key layering (docs/LLM_PROVIDER_LAYER.md,
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
 * Resolve a provider API key with the documented precedence, or undefined when
 * nothing is configured. A configured-but-undecryptable stored key fails LOUD
 * (the decrypt error propagates) rather than silently falling through to the
 * platform/env key — same contract as buildLlmConfigEnv: misattributing a
 * customer's BYOM traffic to another key is worse than failing.
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
