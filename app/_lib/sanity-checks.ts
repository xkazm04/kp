// Classifier for the engine's per-analysis trust ledger (`sanityChecks`).
//
// The Python pipeline states every check as a sentence — positive states
// ("Salary range order OK", "Score total matches its breakdown") alongside
// degradations and repairs ("Salary range needs manual review", "Archetype
// routing is low-confidence — …"). The UI needs the split so warnings can be
// loud and clean checks can stay collapsed.
//
// The markers below cover every warn-shaped string the engine can emit today
// (pipeline.py: _sanity_checks/_score_sanity_checks/_archetype_sanity_checks/
// _salary_sanity_checks, the repairs[] notes, and _softly's
// "<label> unavailable — insight skipped (manual review)"). These strings are
// deterministic engine English — they are NOT localized by --lang, so matching
// on them is stable across recruiter locales. When adding a new warn-shaped
// check Python-side, either reuse the "(manual review)" suffix (preferred —
// the catch-all here) or add its marker below.
const WARN_MARKERS =
  /manual review|disagrees|low-confidence|outside expected range|is short|is inconsistent|unavailable|failed/i;

export function isSanityWarn(check: string): boolean {
  return WARN_MARKERS.test(check);
}

export function splitSanityChecks(checks: string[]): { warns: string[]; oks: string[] } {
  const warns: string[] = [];
  const oks: string[] = [];
  for (const check of checks) (isSanityWarn(check) ? warns : oks).push(check);
  return { warns, oks };
}

/** Warn count stamped onto `analyses.review_flags` at save time, so the History
 *  list can show a per-row flag pill without scanning 200 payload blobs. */
export function countSanityWarns(checks: string[]): number {
  return checks.reduce((n, check) => (isSanityWarn(check) ? n + 1 : n), 0);
}

// CV authenticity trust band (idea-cae71d45). The Python pre-screen folds
// `Authenticity: …` findings into the trust ledger (sanityChecks); risky ones
// carry the warn marker. The band is derived from how many warned: 0 → high
// trust, 1 → medium, 2+ → low. Mirrors pipeline/jobfit/authenticity.authenticity_band.
export const AUTHENTICITY_PREFIX = "Authenticity";

/** The trust band for an analysis, or null when the payload carries no
 *  authenticity check (an older analysis run before this screen existed). */
export function authenticityBand(checks: string[]): "high" | "medium" | "low" | null {
  const auth = checks.filter((c) => c.startsWith(AUTHENTICITY_PREFIX));
  if (auth.length === 0) return null;
  const warns = auth.filter(isSanityWarn).length;
  return warns === 0 ? "high" : warns === 1 ? "medium" : "low";
}
