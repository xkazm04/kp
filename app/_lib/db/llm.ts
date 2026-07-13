import { readFileSync, rmSync } from "node:fs";
import { parseLedgerLine, type LlmUsageInput } from "../llm-usage-ledger";
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

// ---- Metering ledger (T0.1) ------------------------------------------------
// One row per metered LLM envelope — the durable spend/usage record the pricing
// meters and the Models usage panel bill/aggregate against. Restored + WIRED
// after the 2026-06-14 refactor deleted it as an unwired stub. The TS side owns
// the DB (Python stays DB-free): Python's monitor.emit_result appends one NDJSON
// line per call to a per-spawn sidecar file, and spawnPython calls
// ingestLlmUsageLog() to fold those lines in here after the child exits.

export type { LlmUsageInput };

export function insertLlmUsage(input: LlmUsageInput): void {
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

/**
 * Fold a per-spawn LLM-usage sidecar file (NDJSON, written by Python's
 * monitor.emit_result) into the llm_usage table, then delete the file. Each line
 * is one metered call. Returns the number of rows ingested. Fully defensive: a
 * missing/empty file is a no-op (the spawned CLI made no LLM call), a corrupt or
 * incomplete line is dropped by parseLedgerLine (not fatal), and the whole
 * operation is wrapped by the caller so ledger I/O can never break a spawn — the
 * ledger is telemetry, off the critical path.
 */
export function ingestLlmUsageLog(logPath: string): number {
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return 0; // file never created → no LLM calls in this spawn
  }
  const rows = raw.split(/\r?\n/).map(parseLedgerLine).filter((r): r is LlmUsageInput => r !== null);
  if (rows.length > 0) {
    const db = ensureDb();
    db.transaction((batch: LlmUsageInput[]) => {
      for (const row of batch) insertLlmUsage(row);
    })(rows);
  }
  try {
    rmSync(logPath, { force: true });
  } catch {
    /* best-effort cleanup */
  }
  return rows.length;
}

export type LlmUsageAggregateRow = {
  day: string;
  useCase: string;
  provider: string;
  model: string | null;
  calls: number;
  // bug-ui-scan-2026-07-09 (model-api-key-management #3): how many of `calls` had
  // NULL cost_usd (Azure / unknown-model spend). cost_usd sums them as 0, so the
  // usage panel needs this to distinguish "cost $0" from "cost unknown".
  unpricedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
};

/**
 * Per (day × use_case × provider × model) rollup of the ledger — the shape the
 * Models usage panel and the pricing meters read. `sinceDays` bounds the scan to
 * recent rows (default 30). Costs sum only the rows that carry a cost_usd;
 * `unpricedCalls` counts the rows that don't (see the type note above).
 */
export function aggregateLlmUsage(sinceDays = 30): LlmUsageAggregateRow[] {
  const db = ensureDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT substr(ts, 1, 10) AS day, use_case, provider, model,
              COUNT(*) AS calls,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_calls,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM llm_usage
        WHERE ts >= ?
        GROUP BY day, use_case, provider, model
        ORDER BY day DESC, cost_usd DESC`
    )
    .all(since) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    day: r.day as string,
    useCase: r.use_case as string,
    provider: r.provider as string,
    model: (r.model as string) ?? null,
    calls: Number(r.calls ?? 0),
    unpricedCalls: Number(r.unpriced_calls ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cachedTokens: Number(r.cached_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

