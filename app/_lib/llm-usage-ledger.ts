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

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
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
    inputTokens: numOrNull(parsed.input_tokens),
    outputTokens: numOrNull(parsed.output_tokens),
    cachedTokens: numOrNull(parsed.cached_tokens),
    costUsd: numOrNull(parsed.cost_usd),
    source: parsed.source === "deterministic" ? "deterministic" : "llm",
    requestId: strOrNull(parsed.request_id),
  };
}
