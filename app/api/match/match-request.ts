// The two pure input sanitizers POST /api/match applies before it spawns Python.
//
// Both lived inline in the route, which is untestable in the unit runner (it needs a
// Next request scope), so the only thing standing behind "whatever the client sends
// becomes a defined contract" was the comment saying so. Extracted verbatim — same
// bounds, same fallbacks — so the boundary is pinned by tests rather than by prose.

// match() does scored[:limit] in Python, so the limit must be a sane positive
// integer: a negative value silently drops the last N matches, 0 returns nothing
// while meta still reports survivors, and a float raises an opaque TypeError.
// Coerce + clamp at this boundary so "whatever the client sends" becomes a
// defined 1..200 contract (default 50).
export const MATCH_LIMIT_DEFAULT = 50;
export const MATCH_LIMIT_MIN = 1;
export const MATCH_LIMIT_MAX = 200;

export function resolveMatchLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MATCH_LIMIT_DEFAULT;
  return Math.min(MATCH_LIMIT_MAX, Math.max(MATCH_LIMIT_MIN, Math.floor(raw)));
}

/** Recruiter weight override (MAT1): kept only when it is a plain object, and only
 *  its finite-number entries survive. Returns null when there is nothing to forward,
 *  so the caller passes `--weights` or does not — never an empty vector, which the
 *  Python scorer would read as "override everything to zero".
 *
 *  The Python scorer clamps what it receives to the archetype's bounds and
 *  renormalizes, so this is not the range check; it is the TYPE gate that stops a
 *  string/array/NaN reaching JSON.stringify and then argv. */
export function sanitizeMatchWeights(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const w: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) w[k] = v;
  }
  return Object.keys(w).length > 0 ? w : null;
}
