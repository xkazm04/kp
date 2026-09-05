// Pure parsing/validation for the LLM usage ledger (T0.1), with NO database
// dependency so it is unit-testable under `node --test` (the SQLite store isn't
// loadable there). db/llm.ts does the file read + INSERT around this.
//
// One sidecar NDJSON line is emitted per metered call by Python's
// monitor.emit_result (snake_case keys); parseLedgerLine validates + maps it to
// the insertLlmUsage shape, returning null for a row that must be dropped.

/**
 * VISIBLE WITHOUT BEING BILLABLE (tiger X2/X14, 2026-09-05).
 *
 * Two facts wanted a home here and they pull in opposite directions. A failed
 * attempt — a timeout, a 429 — happens AFTER the prompt was sent, so it cost real
 * money, and until now it was recorded nowhere: `emit_error` returned early when
 * LightTrack was absent, which is the default deployment, so the spend panel
 * under-reported exactly the traffic an operator most needs to see. But this table's
 * whole honesty property is that a row in it is a call that HAPPENED and can be
 * summed; writing failures in as ordinary usage would corrupt `SUM(cost_usd)` and
 * `SUM(input_tokens)` — the figures the Models panel and the pricing meters read —
 * with numbers nobody can source, since a dead call reports no usage block.
 *
 * The resolution is `outcome`, and its precedent is already in this file:
 * `unpriced_calls`. When the ledger cannot price a row it does not guess and it does
 * not drop it — it puts the row in a NAMED bucket, where it is countable, beside the
 * sum rather than inside it. `outcome` is that same move for a row that cannot be
 * METERED at all. A failed row lands with NULL tokens and NULL cost (unknown, stated
 * as unknown), it is listed in Activity, it is counted as `failedCalls` — and every
 * money-shaped aggregate in db/llm.ts, analytics.ts and interviews.ts names
 * `outcome = 'ok'` EXPLICITLY, so no future row class can join a total by accident.
 * That last part is the point: a new row class an existing aggregate silently
 * includes would be a worse bug than the invisibility being fixed.
 *
 * `reason` is the other half — the descent reason Python has computed all along
 * (`automation._call_failure_reason`, `"unusable_output"`, the availability-gate
 * vocabulary) and which reached only the per-request CLI envelope. It is a CODE from
 * a closed vocabulary, never a provider message: the message is provider-authored
 * text that can echo the prompt, and this is a durable column.
 */
export type LlmUsageInput = {
  useCase: string;
  provider: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  costUsd?: number | null;
  source: "llm" | "deterministic";
  /** "ok" = a meterable attempt (a real completion, or a deterministic template
   *  serve at a truthful zero). "failed" = the attempt raised; excluded from every
   *  billable aggregate. See the note above. */
  outcome: "ok" | "failed";
  /** Why this row is not a plain successful serve — a closed-vocabulary code from
   *  monitor.py (`FAILURE_REASONS`) or automation.py (`DEGRADATION_REASONS` and the
   *  availability-gate words). Null when there is nothing to explain. */
  reason?: string | null;
  requestId?: string | null;
};

/** A finite, NON-NEGATIVE number, else null.
 *
 *  The sign bound is load-bearing, not tidiness. db/llm.ts aggregates this table
 *  with `COALESCE(SUM(cost_usd), 0)` and `SUM(input_tokens)` — the figures the
 *  Models usage panel shows and the pricing meters read — so ONE negative row
 *  silently subtracts from every total that contains it, and the resulting number
 *  is wrong in the direction nobody audits. A negative is not a small cost; it is
 *  an unreadable one, and this table already has a word for that: `cost_usd IS
 *  NULL` is counted as `unpriced_calls`. Dropping to null puts the row in that
 *  bucket, where it is visible, instead of into the sum, where it is not.
 *
 *  Reachable without anyone writing a negative on purpose: cached-token discounts
 *  are computed by SUBTRACTION on the Python side, and a provider that reports
 *  more cached tokens than input tokens produces exactly this. Same bound
 *  `report-payload.ts` puts on the agent ledger next door, for the same reason. */
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** Token counts are counts, and the columns are INTEGER (db/core.ts). A
 *  fractional value would be a bug upstream either way; rounding keeps it from
 *  reaching the column as a float that later reads back differently. */
const countOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
};

const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** The shape `llm_usage.reason` is allowed to hold: one lowercase snake_case token,
 *  ≤64 chars. Python already reduces a prose fallback line to a code before it writes
 *  the sidecar (`monitor._reason_code`), and this re-asserts it at the trust boundary
 *  rather than trusting that — the sidecar is a FILE, and a column read back into an
 *  operator-facing table must not be able to carry a provider's message (which can
 *  echo the prompt) because one producer forgot. Anything else is dropped to null:
 *  "no reason recorded" is honest, an unbounded string is not. */
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const reasonOrNull = (v: unknown): string | null => {
  const s = strOrNull(v);
  return s !== null && REASON_CODE.test(s) ? s : null;
};

/**
 * Parse one sidecar NDJSON line into an insertLlmUsage input, or null if it must
 * be dropped. Defensive by contract: a non-JSON line, or one missing the NOT
 * NULL columns (use_case / provider), returns null rather than throwing, so one
 * bad line never aborts ingesting the rest. `source` defaults to "llm" (only
 * real LLM calls reach the monitor seam; anything else is coerced to that unless
 * it explicitly says "deterministic").
 *
 * `outcome` defaults to "ok" for the same reason and one more: every line written
 * before this column existed omits the key, and those lines recorded calls that
 * SUCCEEDED — they are the whole reason the ledger has numbers in it. Coercing an
 * unknown value to "ok" would be the wrong default in the other direction (a
 * garbled failure joining the billable totals), so the ONLY value that produces
 * "failed" is the literal, and the only value that produces "ok" is the literal or
 * an absent key; anything else is a line we cannot classify and the whole line is
 * dropped rather than guessed into a money column.
 */
export function parseLedgerLine(line: string): LlmUsageInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(trimmed);
    if (value === null || typeof value !== "object") return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const useCase = strOrNull(parsed.use_case);
  const provider = strOrNull(parsed.provider);
  if (!useCase || !provider) return null; // NOT NULL columns
  const rawOutcome = parsed.outcome;
  if (rawOutcome !== undefined && rawOutcome !== "ok" && rawOutcome !== "failed") return null;
  const outcome: "ok" | "failed" = rawOutcome === "failed" ? "failed" : "ok";
  return {
    useCase,
    provider,
    model: strOrNull(parsed.model),
    inputTokens: countOrNull(parsed.input_tokens),
    outputTokens: countOrNull(parsed.output_tokens),
    cachedTokens: countOrNull(parsed.cached_tokens),
    costUsd: numOrNull(parsed.cost_usd),
    source: parsed.source === "deterministic" ? "deterministic" : "llm",
    outcome,
    reason: reasonOrNull(parsed.reason),
    requestId: strOrNull(parsed.request_id),
  };
}
