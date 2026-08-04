import { insertLlmUsage } from "@/app/_lib/db/llm";
import { trackLlmToLightTrack } from "@/app/_lib/llm-lighttrack";

// Metering for the GitHub deep-review Gemini call (/api/github-analysis).
// The model id lives here next to its price book on purpose: the cost stamped on
// the ledger row must always belong to the model that was actually called, so the
// two can never be edited apart. code-review.ts imports GEMINI_MODEL from here.
export const GEMINI_MODEL = "gemini-3-flash-preview";

// USD per million tokens for GEMINI_MODEL — keep in sync with MTOK_PRICES in
// pipeline/jobfit/llm/base.py (Python is the price book of record; this pair
// exists only so the one TS-direct Gemini call stamps the same cost_usd on its
// llm_usage ledger row as the Python adapters do).
const GEMINI_MTOK_PRICE_IN_USD = 0.3;
const GEMINI_MTOK_PRICE_OUT_USD = 2.5;

// Stamp the deep-review Gemini call into BOTH telemetry sinks — the durable
// llm_usage ledger and LightTrack. The LLM-cost audit flagged this site as the
// app's only TS-direct Gemini traffic (every Python call meters via
// monitor.emit_result; this is the one call that never reaches Python), so it is
// the one place the TS runtime has to mirror what the Python monitor does. Both
// writes happen only when the response carries usage metadata, and both are
// wrapped so telemetry I/O can never break the analysis: metering is off the
// critical path (same contract as ingestLlmUsageLog / gemini.py _meter_success).
export function recordGeminiUsage(
  requestId: string | undefined,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } | undefined,
  latencyMs?: number
): void {
  if (!usage) return;
  const inputTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null;
  const outputTokens = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null;
  if (inputTokens === null && outputTokens === null) return;
  const cachedTokens = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : null;
  const costUsd = round6(
    ((inputTokens ?? 0) * GEMINI_MTOK_PRICE_IN_USD + (outputTokens ?? 0) * GEMINI_MTOK_PRICE_OUT_USD) / 1_000_000
  );
  // Durable spend ledger — written first, independent of LightTrack below (same
  // ordering as gemini.py _meter_success: the ledger must persist even when
  // observability is off, the default deployment).
  try {
    insertLlmUsage({
      useCase: "github_analysis",
      provider: "gemini",
      model: GEMINI_MODEL,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      source: "llm",
      requestId: requestId ?? null,
    });
  } catch {
    // metering must never break the host call
  }
  // Observability mirror: surface this TS-direct call in LightTrack alongside
  // every Python-metered call, so the one pane of glass isn't missing it. No-op
  // unless LIGHTTRACK_URL is set; best-effort and exception-swallowed.
  trackLlmToLightTrack({
    provider: "gemini",
    model: GEMINI_MODEL,
    useCase: "github_analysis",
    inputTokens,
    outputTokens,
    cachedTokens,
    costUsd,
    latencyMs,
  });
}

// Six-decimal rounding for cost_usd, matching Python's price_usd (llm/base.py).
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
