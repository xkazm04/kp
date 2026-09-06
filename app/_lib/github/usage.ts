import { insertLlmUsage } from "@/app/_lib/db/llm";
import { trackLlmToLightTrack } from "@/app/_lib/llm-lighttrack";

// Metering for the GitHub deep-review Gemini call (/api/github-analysis).
// The model id lives here next to its price book on purpose: the cost stamped on
// the ledger row must always belong to the model that was actually called, so the
// two can never be edited apart. code-review.ts imports GEMINI_MODEL from here.
export const GEMINI_MODEL = "gemini-3.8-flash";

// USD per million tokens for GEMINI_MODEL — keep in sync with MTOK_PRICES in
// pipeline/jobfit/llm/base.py (Python is the price book of record; this pair
// exists only so the one TS-direct Gemini call stamps the same cost_usd on its
// llm_usage ledger row as the Python adapters do). The output price had drifted
// to 7.5 against the record's 7.00, so every github_analysis row overstated its
// output cost by ~7% and disagreed with every Python-metered Gemini call in the
// same ledger — usage.test.ts now pins the pair to base.py so it can't drift again.
//
// 2026-09-02: GEMINI_MODEL moved 3.6 -> 3.8, so this pair follows base.py's 3.8
// row, NOT its 3.6 row. Note the coincidence and do not read it as the old drift
// returning: 7.5 is now the CORRECT output figure because it is 3.8's standard
// rate, where before it was a wrong copy of 3.6's 7.00. base.py books 3.8 at the
// standard rate rather than its introductory 0.75/3.75 (which runs to 2026-12-31)
// so cross-model comparisons don't silently improve and then lapse; this pair
// mirrors that choice, because the two must agree or the ledger disagrees with itself.
const GEMINI_MTOK_PRICE_IN_USD = 1.5;
const GEMINI_MTOK_PRICE_OUT_USD = 7.5;

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
  latencyMs?: number,
  model: string = GEMINI_MODEL
): void {
  if (!usage) return;
  const inputTokens = typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null;
  const outputTokens = typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null;
  if (inputTokens === null && outputTokens === null) return;
  const cachedTokens = typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : null;
  // The price pair belongs to GEMINI_MODEL only. A config-pinned different model
  // stays unpriced (cost_usd null, token-metered) — same convention as Azure
  // deployment names in MTOK_PRICES: never bill against the wrong price row.
  const costUsd =
    model === GEMINI_MODEL
      ? round6(
          ((inputTokens ?? 0) * GEMINI_MTOK_PRICE_IN_USD + (outputTokens ?? 0) * GEMINI_MTOK_PRICE_OUT_USD) / 1_000_000
        )
      : null;
  // Durable spend ledger — written first, independent of LightTrack below (same
  // ordering as gemini.py _meter_success: the ledger must persist even when
  // observability is off, the default deployment).
  try {
    insertLlmUsage({
      useCase: "github_analysis",
      provider: "gemini",
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
      costUsd,
      source: "llm",
      outcome: "ok", // this seam is reached only after a completion came back
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
    model,
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
