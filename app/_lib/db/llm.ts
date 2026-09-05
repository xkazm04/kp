import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { parseLedgerLine, type LlmUsageInput } from "../llm-usage-ledger";
import { ensureDb, safeRowParse } from "./core";

// ---- Multi-provider LLM layer (docs/architecture/llm-provider-layer.md) -----------------
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

/**
 * Pin (or re-pin) a use case. Returns false ONLY when `expectedUpdatedAt` was
 * supplied and no longer matches the stored row — nothing was written.
 *
 * VERSION PRECONDITION (/perfect 2026-09-03, model-keys-need-the-org-key). The
 * Models table renders `updatedAt` on every pinned row and its editor is a
 * long-lived draft — two operators (or two tabs) can sit on the same row for
 * minutes. The unconditional upsert this used to be made that last-writer-wins:
 * the second save silently replaced a provider/model the first had just chosen,
 * with the row's own displayed version proving nothing because it never
 * travelled back. The caller now echoes what it read and the UPDATE re-asserts
 * it in the WHERE, so a save composed against a superseded row is DROPPED rather
 * than applied — the compare-and-swap shape `actOnPipelineEntry` establishes.
 *
 * `.immediate()`, because this is a read→compute→write: the INSERT-vs-UPDATE
 * decision reads the row, so a plain deferred transaction could take its write
 * lock after another writer had already inserted.
 *
 * `expectedUpdatedAt: undefined` means "no opinion" (a headless or first-time
 * write) and keeps the old unconditional behaviour; `null` means "I read NO row
 * here", which refuses if a row has since appeared.
 */
export function upsertLlmConfig(input: {
  useCase: string;
  provider: string;
  model?: string | null;
  params?: Record<string, unknown>;
  expectedUpdatedAt?: string | null;
}): boolean {
  const db = ensureDb();
  const now = new Date().toISOString();
  const paramsJson = JSON.stringify(input.params ?? {});
  const apply = db.transaction((): boolean => {
    const current = db.prepare(`SELECT updated_at FROM llm_config WHERE use_case = ?`).get(input.useCase) as
      | { updated_at: string }
      | undefined;
    const seen = current?.updated_at ?? null;
    if (input.expectedUpdatedAt !== undefined && seen !== input.expectedUpdatedAt) return false;
    // The stamp IS the version token, so it must strictly increase. An ISO string has
    // millisecond resolution and two writes can land inside one — which would hand the
    // next writer a token that still matches a row someone else has already replaced,
    // i.e. exactly the lost update this precondition exists to stop. Nudge past a
    // collision rather than letting the version stand still.
    const stamp = seen !== null && seen >= now ? new Date(Date.parse(seen) + 1).toISOString() : now;
    db.prepare(
      `INSERT INTO llm_config (use_case, provider, model, params_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (use_case) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         params_json = excluded.params_json,
         updated_at = excluded.updated_at`
    ).run(input.useCase, input.provider, input.model ?? null, paramsJson, stamp);
    return true;
  });
  return apply.immediate();
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

/** The outcome of a provider-key write. `updatedAt` is the row's version either
 *  way — the one just written, or the CURRENT one a stale caller must reload onto. */
export type ProviderKeyWriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "stale"; updatedAt: string | null };

/**
 * Upsert one (provider, scope) credential.
 *
 * OPTIMISTIC CONCURRENCY. A provider key is the deployment's spending credential,
 * encrypted at rest and unrecoverable once replaced, so a blind upsert makes two
 * admins rotating the same row in overlapping tabs a silent data loss: the loser
 * sees "Saved" over a key that was overwritten seconds later. `expectedUpdatedAt`
 * is the version the caller rendered; it is re-asserted INSIDE `.immediate()` (the
 * write lock is taken at BEGIN, so the read→compare→write cannot interleave) and a
 * mismatch — including a row deleted underneath the caller — is refused rather than
 * written. Omitting it keeps last-writer-wins for headless callers that never read
 * a version and therefore cannot hold a stale one.
 *
 * `updated_at` is that version token, so it is written STRICTLY INCREASING: two
 * writes inside one millisecond would otherwise share a value and make the second
 * writer's stale token look current.
 */
export function upsertProviderKey(input: {
  provider: string;
  scope: string;
  keyCiphertext: string;
  meta?: Record<string, unknown>;
  expectedUpdatedAt?: string | null;
}): ProviderKeyWriteResult {
  const db = ensureDb();
  const metaJson = JSON.stringify(input.meta ?? {});
  // No await anywhere inside: better-sqlite3 transactions are synchronous.
  const write = db.transaction((): ProviderKeyWriteResult => {
    const row = db
      .prepare(`SELECT updated_at FROM provider_keys WHERE provider = ? AND scope = ?`)
      .get(input.provider, input.scope) as { updated_at?: string } | undefined;
    const current = row?.updated_at ?? null;
    if (input.expectedUpdatedAt != null && current !== input.expectedUpdatedAt) {
      return { ok: false, reason: "stale", updatedAt: current };
    }
    const previous = current ? Date.parse(current) : Number.NaN;
    const updatedAt = new Date(
      Number.isFinite(previous) ? Math.max(Date.now(), previous + 1) : Date.now()
    ).toISOString();
    db.prepare(
      `INSERT INTO provider_keys (provider, scope, key_ciphertext, meta_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider, scope) DO UPDATE SET
         key_ciphertext = excluded.key_ciphertext,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at`
    ).run(input.provider, input.scope, input.keyCiphertext, metaJson, updatedAt);
    return { ok: true, updatedAt };
  });
  return write.immediate();
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
    `INSERT INTO llm_usage (ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, outcome, reason, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    input.outcome,
    input.reason ?? null,
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
  return ingestLlmUsageResult(logPath).inserted;
}

/** What one fold did: rows written, and rows REFUSED because this exact sidecar
 *  line was already in the ledger (see `ingestLlmUsageResult`). */
export type LlmUsageIngestResult = { inserted: number; skipped: number };

/**
 * The idempotency key for ONE ledger line: the sidecar path (a per-spawn
 * `kp-llm-usage-<pid>-<uuid>.ndjson`, python-runner.ts), the line's ordinal in
 * that file, and the line's bytes. Re-reading the same file yields the same key
 * for the same line, so the second fold is refused; two identical lines from two
 * different spawns, or two identical calls within one spawn, keep distinct keys
 * and both land.
 *
 * Deliberately NOT `request_id`: that id identifies the SPAWN, is stamped on
 * every line the spawn wrote (monitor.py `_request_id`), and is null for any
 * spawn outside a tracked run — so a unique index on it would drop the second
 * and later metered calls of every multi-call pipeline run, which is most of
 * them. The key has to be per LINE because the thing being deduplicated is a
 * line, not a request.
 */
function ingestKeyFor(logPath: string, index: number, line: string): string {
  return createHash("sha256").update(`${logPath} ${index} ${line}`).digest("hex");
}

/**
 * Same fold as {@link ingestLlmUsageLog}, but it also reports how many lines were
 * refused as duplicates.
 *
 * REPLAY SAFETY. Deleting the sidecar afterwards was the ONLY thing that made this
 * idempotent, and that delete is a best-effort `rmSync` whose failure is swallowed
 * on purpose (the ledger must never break a spawn). A locked file on Windows, a
 * read-only temp dir, or a crash between the INSERT and the unlink therefore left
 * the file exactly where the next ingest of the same path would read it again —
 * and with no key to refuse on, every row landed twice and the pricing meters
 * billed double for spend that happened once. `INSERT OR IGNORE` on the
 * `ingest_key` unique index (core.ts) makes the replay a no-op, and the skip is
 * COUNTED rather than swallowed: a non-zero `skipped` means a cleanup failed, which
 * is an operator-actionable fact.
 */
export function ingestLlmUsageResult(logPath: string): LlmUsageIngestResult {
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return { inserted: 0, skipped: 0 }; // file never created → no LLM calls in this spawn
  }
  const rows = raw
    .split(/\r?\n/)
    .map((line, index) => {
      const parsed = parseLedgerLine(line);
      return parsed === null ? null : { row: parsed, key: ingestKeyFor(logPath, index, line) };
    })
    .filter((r): r is { row: LlmUsageInput; key: string } => r !== null);
  let inserted = 0;
  if (rows.length > 0) {
    const db = ensureDb();
    // No await anywhere inside: better-sqlite3 transactions are synchronous.
    const fold = db.transaction((batch: typeof rows) => {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO llm_usage
           (ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, outcome, reason, request_id, ingest_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      let written = 0;
      for (const { row, key } of batch) {
        written += stmt.run(
          new Date().toISOString(),
          row.useCase,
          row.provider,
          row.model ?? null,
          row.inputTokens ?? null,
          row.outputTokens ?? null,
          row.cachedTokens ?? null,
          row.costUsd ?? null,
          row.source,
          row.outcome,
          row.reason ?? null,
          row.requestId ?? null,
          key
        ).changes;
      }
      return written;
    });
    inserted = fold(rows);
  }
  const skipped = rows.length - inserted;
  if (skipped > 0) {
    console.warn(
      `[llm-usage] ${skipped} of ${rows.length} ledger line(s) in ${logPath} were already ingested — the sidecar's cleanup did not run last time; spend was NOT double-counted`
    );
  }
  try {
    rmSync(logPath, { force: true });
  } catch {
    /* best-effort cleanup — the ingest_key index above is what makes a re-read safe */
  }
  return { inserted, skipped };
}

// ---- Activity log (Insights → Activity) ------------------------------------

export type LlmActivityRow = {
  id: number;
  ts: string;
  useCase: string;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  source: string;
  /** "ok" | "failed" — see the visible-but-not-billable note in llm-usage-ledger.ts.
   *  A failed attempt is LISTED here (that is the point: an operator has to be able
   *  to see the timeout that cost them a prompt) while contributing to no total. */
  outcome: string;
  /** Closed-vocabulary descent/failure code, or null when there is nothing to explain. */
  reason: string | null;
  requestId: string | null;
};

/** How many ledger rows the Activity tab loads — a bounded in-memory window the
 *  shared client-side TablePager slices (its documented contract). The tab says
 *  the window size out loud; older spend stays summarized in aggregateLlmUsage. */
export const LLM_ACTIVITY_WINDOW = 500;

/**
 * The most recent individual LLM actions, newest first — the row-level audit
 * trail behind the Activity tab (the Models usage panel reads the daily rollup,
 * aggregateLlmUsage, instead). Bounded by `limit`; org-level like the rest of
 * the ledger (llm_usage is tenancy-exempt config/metering).
 */
export function listLlmActivity(limit = LLM_ACTIVITY_WINDOW): LlmActivityRow[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, ts, use_case, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, source, outcome, reason, request_id
         FROM llm_usage
        ORDER BY ts DESC, id DESC
        LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    ts: r.ts as string,
    useCase: r.use_case as string,
    provider: r.provider as string,
    model: (r.model as string) ?? null,
    inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
    cachedTokens: r.cached_tokens == null ? null : Number(r.cached_tokens),
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    source: r.source as string,
    // Defensive `?? "ok"`: the column is NOT NULL DEFAULT 'ok' so this cannot be
    // null in a migrated DB, but a row is only ever rendered, never re-summed here.
    outcome: (r.outcome as string) ?? "ok",
    reason: (r.reason as string) ?? null,
    requestId: (r.request_id as string) ?? null,
  }));
}

/** The zone `aggregateLlmUsage` cuts its DAYS in. `substr(ts, 1, 10)` takes the
 *  date part of an ISO-8601 UTC timestamp, so every bucket edge is a UTC midnight
 *  — for a Prague operator that is 01:00 or 02:00 local, and an LLM call made late
 *  in the evening lands in the NEXT day's cost column. Small, real, and invisible
 *  while nothing on the wire said which zone the rollup counted in. Stated on every
 *  bucket rather than assumed; re-cutting the buckets in the operator's zone is a
 *  separate decision (it needs an operator zone to exist first). */
export const LLM_USAGE_DAY_TZ = "UTC" as const;

export type LlmUsageAggregateRow = {
  day: string;
  /** {@link LLM_USAGE_DAY_TZ} — the zone `day`'s boundaries were cut in. */
  tz: typeof LLM_USAGE_DAY_TZ;
  useCase: string;
  provider: string;
  model: string | null;
  calls: number;
  // bug-ui-scan-2026-07-09 (model-api-key-management #3): how many of `calls` had
  // NULL cost_usd (Azure / unknown-model spend). cost_usd sums them as 0, so the
  // usage panel needs this to distinguish "cost $0" from "cost unknown".
  unpricedCalls: number;
  // tiger X2: attempts in this bucket that RAISED (outcome 'failed'). Deliberately
  // OUTSIDE `calls` and outside every sum below — a timed-out call spent real money
  // but reported no tokens, so it is counted, never priced. See the
  // visible-but-not-billable note in llm-usage-ledger.ts.
  failedCalls: number;
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
 *
 * A group whose only rows FAILED reports calls 0 and failedCalls N. That is not an
 * empty row to be filtered out — it is the answer to "why did this use case cost
 * nothing this morning", which before tiger X2 the ledger could not give at all.
 */
export function aggregateLlmUsage(sinceDays = 30): LlmUsageAggregateRow[] {
  const db = ensureDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      // Every aggregate below is conditioned on outcome, NOT filtered in the WHERE:
      // a failed attempt has to stay in its (day × use_case × provider × model)
      // bucket to be countable as `failed_calls`, while contributing to nothing
      // else. `unpriced_calls` is conditioned too — a failed row carries NULL cost
      // by construction, and letting it into that count would have turned "we
      // cannot price this call" into "the provider died", two different facts the
      // operator acts on differently. Pre-migration rows are all outcome 'ok'
      // (NOT NULL DEFAULT), so a populated DB reads byte-identically.
      `SELECT substr(ts, 1, 10) AS day, use_case, provider, model,
              SUM(CASE WHEN outcome = 'ok' THEN 1 ELSE 0 END) AS calls,
              SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed_calls,
              SUM(CASE WHEN outcome = 'ok' AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_calls,
              COALESCE(SUM(CASE WHEN outcome = 'ok' THEN input_tokens END), 0) AS input_tokens,
              COALESCE(SUM(CASE WHEN outcome = 'ok' THEN output_tokens END), 0) AS output_tokens,
              COALESCE(SUM(CASE WHEN outcome = 'ok' THEN cached_tokens END), 0) AS cached_tokens,
              COALESCE(SUM(CASE WHEN outcome = 'ok' THEN cost_usd END), 0) AS cost_usd
         FROM llm_usage
        WHERE ts >= ?
        GROUP BY day, use_case, provider, model
        ORDER BY day DESC, cost_usd DESC`
    )
    .all(since) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    day: r.day as string,
    tz: LLM_USAGE_DAY_TZ,
    useCase: r.use_case as string,
    provider: r.provider as string,
    model: (r.model as string) ?? null,
    calls: Number(r.calls ?? 0),
    unpricedCalls: Number(r.unpriced_calls ?? 0),
    failedCalls: Number(r.failed_calls ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cachedTokens: Number(r.cached_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

