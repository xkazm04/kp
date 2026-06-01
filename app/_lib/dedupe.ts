// Order-preserving de-duplication for the string lists that LLM analysis output
// fills — strengths, gaps, salary rationale, sources, matching/missing skills,
// keyword lists. The model routinely repeats a line verbatim; left in place each
// duplicate both shows twice in the UI and collides as a React key, so React
// drops or mis-reconciles nodes (and for stateful rows like the skill-evidence
// tooltip, binds hover state to the wrong node). Keeping the first occurrence
// preserves the model's ordering.

/** Unique strings, first-occurrence order preserved. */
export function dedupe(items: readonly string[]): string[] {
  return Array.from(new Set(items));
}

/**
 * De-duplicate objects by a derived string key, keeping the first occurrence.
 * For list rows whose identity is a single field (e.g. a keyword) but which
 * carry extra data alongside it.
 */
export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
