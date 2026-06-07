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
