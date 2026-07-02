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

// ---------------------------------------------------------------------------
// THE CANONICAL MATCH-SCORE READ PATH (REC-01 / OO-L2-10).
//
// "The match score" has THREE independent producers, none of which used to be
// reconciled anywhere — the same candidate showed 57 on the offer-approval card
// header, 49 in the salary rationale that actually PRICED the offer, and 70 in
// the drawer timeline, all rendered as an undifferentiated 0-100 "match".
// The producer map:
//
//   (A) `analyses.score` — the persisted CV-analysis total, keyed by
//       (candidate_label, jd_slug) in app/_lib/db/analyses.ts. Rendered on the
//       Analyze report, /history, the JD candidate list and the drawer timeline
//       ("CV analysis saved — score N").
//   (B) `pipeline_entries.match_score` — a SNAPSHOT stamped at add-to-pipeline
//       time (useAddToPipeline.ts → POST /api/pipeline, from whatever surface
//       ranked the candidate) or backfilled once by the automation sweep
//       (automation-pass.ts scoreUnscoredEntries → rankPoolForJob → python
//       score_job total; FILL-ONLY). This is the number DECISIONS act on:
//       screen-wave thresholds, advance-top-N, the policy pass.
//   (C) fresh `score_job(candidate, job).total` recomputed at task time —
//       automation_cli.py re-scores at draft_offer time and prices the salary
//       from ITS m.total (pipeline/jobfit/automation.py draft_offer); the same
//       fresh recompute backs /api/match and the group-eval ranker. Never
//       persisted back to the entry, so it silently diverges from (B).
//
// Unification contract: surfaces that show "the match score" for a pipeline
// entry resolve it through `getCanonicalMatchScore` and show the SAME number
// with its PROVENANCE. Precedence (freshest wins, absence stays absent):
//
//   1. the freshest saved analysis fit FOR THIS JOB — producer (A), but only
//      when the analysis is genuinely job-matched (the caller resolves
//      entry.jobId → jd slug via jd-limits.ts and joins by exact candidate
//      label; see match-score-resolve.ts). Provenance: { source: "analysis" }.
//   2. the entry's own `matchScore` snapshot — producer (B).
//      Provenance: { source: "snapshot" }.
//   3. null — never a fabricated 0 (see the null-score policy above).
//
// Numbers that are genuinely a DIFFERENT concept — the draft-time pricing basis
// (C) on the offer card, the group-eval ranking total — are not folded into the
// canonical number; they must be rendered under their own label (e.g. the offer
// card's "fresh fit check at draft: N/100" line reading `matchBasis` from the
// offer payload) instead of all reading bare "match".
//
// This module stays pure (no DB); the server-side resolution of "freshest
// analysis for this job" lives in app/_lib/match-score-resolve.ts and rides the
// /api/pipeline payload as `canonicalScore` + `scoreProvenance`.
// ---------------------------------------------------------------------------

/** The job-matched analysis fact the caller resolved for an entry (or null). */
export type AnalysisFit = {
  score: number | null;
  /** ISO timestamp the analysis was saved (its freshness label). */
  at: string;
  /** Analysis slug for deep-linking (/history/<slug>). */
  slug?: string | null;
};

export type MatchScoreProvenance =
  | { source: "analysis"; at: string; slug: string | null }
  | { source: "snapshot" };

export type CanonicalMatchScore = { score: number; provenance: MatchScoreProvenance } | null;

/** Resolve THE canonical match score for an entry: freshest analysis fit for
 *  THIS job > the entry's snapshot > null. `analysisForThisJob` must already be
 *  job-matched by the caller — passing a label-only (cross-job) analysis here
 *  would re-create the exact conflation this module exists to end. */
export function getCanonicalMatchScore<T extends Scoreable>(
  entry: T,
  analysisForThisJob?: AnalysisFit | null
): CanonicalMatchScore {
  const a = analysisForThisJob;
  if (a && a.score != null && Number.isFinite(a.score)) {
    return {
      score: Math.round(a.score),
      provenance: { source: "analysis", at: a.at, slug: a.slug ?? null },
    };
  }
  if (entry.matchScore != null && Number.isFinite(entry.matchScore)) {
    return { score: entry.matchScore, provenance: { source: "snapshot" } };
  }
  return null;
}

/** An entry as the client sees it: the snapshot plus the canonical fields the
 *  /api/pipeline payload stamps (optional — locally constructed entries, e.g. a
 *  group-eval snapshot, carry only `matchScore`). */
export type CanonicalScored = Scoreable & {
  canonicalScore?: number | null;
  scoreProvenance?: MatchScoreProvenance | null;
};

/** THE number a display surface shows: the stamped canonical score when the
 *  payload carries one, else the snapshot — same precedence as
 *  getCanonicalMatchScore with no analysis fact. Never fabricates. */
export function canonicalScoreOf(e: CanonicalScored): number | null {
  if (e.canonicalScore != null) return e.canonicalScore;
  return e.matchScore ?? null;
}

/** The provenance to render next to `canonicalScoreOf` (null when unscored). */
export function provenanceOf(e: CanonicalScored): MatchScoreProvenance | null {
  if (e.canonicalScore != null) return e.scoreProvenance ?? { source: "snapshot" };
  return e.matchScore != null ? { source: "snapshot" } : null;
}
