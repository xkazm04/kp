// Cache-invalidation contract for per-match reasoning. Kept DB-free (no ./db
// import) so it is unit-testable in isolation — mirrors how cache-key.ts is
// split out of cache.ts.
//
// reasoning_cli tags every payload with a "source": "llm" when ClaudeCliProvider
// produced the rationale, "deterministic" when the provider was unavailable (an
// outage) or its call failed and reasoning_cli fell back to the local template.
//
// Policy: only an *authoritative* LLM verdict is cacheable. Freezing a
// deterministic fallback for the full TTL (168h) would serve a low-quality
// rationale for a week with no way to upgrade once the provider returns — the
// silent staleness trap this contract exists to close. A deterministic verdict
// is still returned to the caller, just never stored; the template is cheap (no
// LLM call), so the first request after the provider recovers recomputes it,
// gets an "llm" verdict, and caches that.
export const CACHEABLE_REASONING_SOURCE = "llm";

export function isCacheableReasoning(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { source?: unknown }).source === CACHEABLE_REASONING_SOURCE
  );
}

// The language the rationale was actually PRODUCED in — which is not always the
// one that was asked for. The deterministic template is English-only by
// construction (match_reasoning.py / reasoning_cli.py both say so), so a `cs`
// request that falls back — no provider configured, a provider outage, or past
// the ai_candidates allowance (--no-llm) — comes back as English prose.
//
// Stamping the REQUESTED locale on it made MatchReasoningPanel's honest "shown
// in {language}" note disappear, because that note fires on
// `narrativeLang !== locale`: the one field carrying the locale honesty of this
// surface was computed from the ask rather than from the answer, so English
// rendered as if it were the Czech narrative. Only an authoritative LLM answer
// is in the engine language.
export function narrativeLangFor(payload: unknown, engineLang: string): string {
  return isCacheableReasoning(payload) ? engineLang : "en";
}
