import { ensureDb, safeRowParse } from "./core";

// ---- Multi-provider LLM layer (docs/LLM_PROVIDER_LAYER.md) -----------------
// Plain row accessors only; validation, key encryption, and KP_LLM_CONFIG
// assembly live in llm-config.ts so this file stays a dumb store.

export type LlmConfigRow = {
  useCase: string;
  provider: string;
  model: string | null;
  params: Record<string, unknown>;
  updatedAt: string;
};

export function listLlmConfig(): LlmConfigRow[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM llm_config ORDER BY use_case`).all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    useCase: r.use_case as string,
    provider: r.provider as string,
    model: (r.model as string) ?? null,
    params: safeRowParse<Record<string, unknown>>(r.params_json as string, "llm_config", r.use_case as string) ?? {},
    updatedAt: r.updated_at as string,
  }));
}

export function upsertLlmConfig(input: {
  useCase: string;
  provider: string;
  model?: string | null;
  params?: Record<string, unknown>;
}): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO llm_config (use_case, provider, model, params_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (use_case) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       params_json = excluded.params_json,
       updated_at = excluded.updated_at`
  ).run(
    input.useCase,
    input.provider,
    input.model ?? null,
    JSON.stringify(input.params ?? {}),
    new Date().toISOString()
  );
}

/** Remove a use-case pin — it reverts to the built-in default provider. */
export function deleteLlmConfig(useCase: string): boolean {
  const db = ensureDb();
  return db.prepare(`DELETE FROM llm_config WHERE use_case = ?`).run(useCase).changes > 0;
}

export type ProviderKeyRow = {
  provider: string;
  scope: string;
  keyCiphertext: string;
  meta: Record<string, unknown>;
  updatedAt: string;
};

export function listProviderKeys(): ProviderKeyRow[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM provider_keys ORDER BY provider, scope`).all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    provider: r.provider as string,
    scope: r.scope as string,
    keyCiphertext: r.key_ciphertext as string,
    meta: safeRowParse<Record<string, unknown>>(r.meta_json as string, "provider_keys", r.provider as string) ?? {},
    updatedAt: r.updated_at as string,
  }));
}

export function upsertProviderKey(input: {
  provider: string;
  scope: string;
  keyCiphertext: string;
  meta?: Record<string, unknown>;
}): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO provider_keys (provider, scope, key_ciphertext, meta_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, scope) DO UPDATE SET
       key_ciphertext = excluded.key_ciphertext,
       meta_json = excluded.meta_json,
       updated_at = excluded.updated_at`
  ).run(input.provider, input.scope, input.keyCiphertext, JSON.stringify(input.meta ?? {}), new Date().toISOString());
}

export function deleteProviderKey(provider: string, scope: string): boolean {
  const db = ensureDb();
  return db.prepare(`DELETE FROM provider_keys WHERE provider = ? AND scope = ?`).run(provider, scope).changes > 0;
}

/** Metering ledger row (one LLM envelope). Emission wires up in Phase 4;
 *  the writer exists now so the schema and the pricing meters share a shape. */
export function insertLlmUsage(input: {
  useCase: string;
  provider: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  costUsd?: number | null;
  source: "llm" | "deterministic";
  requestId?: string | null;
}): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO llm_usage (ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    input.useCase,
    input.provider,
    input.model ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.cachedTokens ?? null,
    input.costUsd ?? null,
    input.source,
    input.requestId ?? null
  );
}

