// Pure parsing/validation for the LLM usage ledger (T0.1), with NO database
// dependency so it is unit-testable under `node --test` (the SQLite store isn't
// loadable there). db/llm.ts does the file read + INSERT around this.
//
// One sidecar NDJSON line is emitted per metered call by Python's
// monitor.emit_result (snake_case keys); parseLedgerLine validates + maps it to
// the insertLlmUsage shape, returning null for a row that must be dropped.

export type LlmUsageInput = {
  useCase: string;
  provider: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  costUsd?: number | null;
  source: "llm" | "deterministic";
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

/**
 * Parse one sidecar NDJSON line into an insertLlmUsage input, or null if it must
 * be dropped. Defensive by contract: a non-JSON line, or one missing the NOT
 * NULL columns (use_case / provider), returns null rather than throwing, so one
 * bad line never aborts ingesting the rest. `source` defaults to "llm" (only
 * real LLM calls reach the monitor seam; anything else is coerced to that unless
 * it explicitly says "deterministic").
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
  return {
    useCase,
    provider,
    model: strOrNull(parsed.model),
    inputTokens: countOrNull(parsed.input_tokens),
    outputTokens: countOrNull(parsed.output_tokens),
    cachedTokens: countOrNull(parsed.cached_tokens),
    costUsd: numOrNull(parsed.cost_usd),
    source: parsed.source === "deterministic" ? "deterministic" : "llm",
    requestId: strOrNull(parsed.request_id),
  };
}
