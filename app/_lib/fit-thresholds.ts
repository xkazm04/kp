// Single source for the "promising fit" match-score floor across the TS surfaces
// that must agree on it (sourcing-campaigns-rediscovery #3). Kept IMPORT-FREE so a
// client component can import the runtime value without pulling in better-sqlite3
// (rediscover.ts, where SCORE_FLOOR used to live, imports the db barrel at module
// top). Mirrors pipeline/jobfit/matching.py's FIT_PROMISING_THRESHOLD — the one
// number the rediscovery admission gate and the Candidates "Pool fit" filter are
// documented to share. The cross-boundary pairing is NO LONGER hand-kept: both
// floors AND the tier vocabulary are bound by
// pipeline/jobfit/tests/test_fit_threshold_sync.py, which reads this file's numeric
// literals and fails CI on divergence (the shape test_prompt_version_sync.py uses
// for the eight prompt versions). Move a floor here and matching.py reddens, and
// vice versa.
export const FIT_PROMISING_FLOOR = 55;

/** The "strong fit" floor — the upper band of the same three-tier scale. Mirrors
 *  pipeline/jobfit/matching.py's FIT_STRONG_THRESHOLD (bound by the same drift test),
 *  and lives here for the same
 *  reason its sibling does: `Badge.tsx::scoreToFitTier` (the fallback that bands a
 *  bare numeric score for every surface with no server-emitted `fitTier`) used to
 *  re-hardcode BOTH numbers, so tuning the shared floor would have moved every gate
 *  while leaving the badge the recruiter reads on the old scale. One scale, one
 *  source, on both sides of the band. */
export const FIT_STRONG_FLOOR = 70;
