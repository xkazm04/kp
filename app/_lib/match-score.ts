// The null-score policy for DECISION surfaces (REC-03 / SD-L1-002).
//
// A pipeline entry's `matchScore` is legitimately absent (degraded intake, added
// before any match run, manual add). The old `?? 0` coercion on matchScore minted
// a genuine-looking 0 for such candidates, which let a never-measured person be
// ranked worst, pass a `score < threshold` auto-reject gate, and have "match 0"
// sealed into the immutable decision chain. UI display components already handle
// null honestly (ScoreBadge renders an em dash) — this module gives the DECISION
// layer the same honesty:
//
//   - `isScored`   — type-narrowing predicate to split a cohort into scored vs
//                    unscored BEFORE any ranking/threshold math (fail closed:
//                    the unscored are excluded, never coerced).
//   - `compareScoreDesc` / `compareByMatchScoreDesc` — best-first comparators
//                    that sort unscored candidates strictly AFTER every scored
//                    one (including a genuine 0) without inventing a number.
//
// Pure and dependency-free so both server modules and client components import it.

export type Scoreable = { matchScore?: number | null };

/** True when the entry carries a real match score. Narrows the type so callers
 *  can rank/threshold without `?? 0` fabrication after filtering. */
export function isScored<T extends Scoreable>(e: T): e is T & { matchScore: number } {
  return e.matchScore != null;
}

/** Descending (best-first) comparator over possibly-absent scores: higher scores
 *  first, unscored (null/undefined) strictly last — an absent measurement never
 *  ties with, or beats, a genuine 0. */
export function compareScoreDesc(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/** `compareScoreDesc` keyed on the shared `matchScore` field. */
export function compareByMatchScoreDesc(a: Scoreable, b: Scoreable): number {
  return compareScoreDesc(a.matchScore, b.matchScore);
}
