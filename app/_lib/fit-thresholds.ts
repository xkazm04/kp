// Single source for the "promising fit" match-score floor across the TS surfaces
// that must agree on it (sourcing-campaigns-rediscovery #3). Kept IMPORT-FREE so a
// client component can import the runtime value without pulling in better-sqlite3
// (rediscover.ts, where SCORE_FLOOR used to live, imports the db barrel at module
// top). Mirrors pipeline/jobfit/matching.py's FIT_PROMISING_THRESHOLD — the one
// number the rediscovery admission gate and the Candidates "Pool fit" filter are
// documented to share; keep the Python constant in sync by hand across the boundary.
export const FIT_PROMISING_FLOOR = 55;
