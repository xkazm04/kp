// Prior-aware rediscovery rank (direction: prior-aware-rediscovery-rank).
//
// A final-round near-miss and a day-one screen-out used to rank identically — the
// rediscovered list was a pure current-fit sort, and pickPrior only LABELLED the
// prior, never scored it. This is the ordering refinement: a small, deterministic,
// BAND-LIMITED boost from how far the prior pipeline entry advanced before its
// terminal outcome, so the most valuable silver medalists float — WITHOUT changing
// the honest base score anyone sees. This is an ordering tiebreak over data already
// fetched, NOT a new scoring model.
//
// Kept in this IMPORT-light sibling (only PIPELINE_STAGES, a pure DB-free axis) so
// the band guarantee is unit-testable under bare `node --test` — rediscover.ts
// pulls in better-sqlite3 + the db barrel + python-runner and won't load there.
import { PIPELINE_STAGES } from "./pipeline-stages";

/** Ordering band, in match-score points. The prior-depth boost may reorder
 *  candidates WITHIN this band of base score but can NEVER lift a candidate past
 *  another whose HONEST base score is more than PRIOR_DEPTH_BAND above it.
 *
 *  5 is the chosen, defensible band: it's half of matching's 10-point fit-tier
 *  step (SCORE_FLOOR=55 mirrors the "promising" tier), so the boost can shuffle a
 *  near-tie inside one tier but never vault a candidate a whole tier's width past
 *  a genuinely stronger fit. The guarantee is STRUCTURAL, not incidental: because
 *  the boost is bounded to [0, PRIOR_DEPTH_BAND], the maximum ordering swing IS
 *  the band. */
export const PRIOR_DEPTH_BAND = 5;

/** Band-limited ordering boost from how far a prior pipeline entry advanced before
 *  its terminal outcome. One point per PIPELINE_STAGES step reached
 *  (Accepted=0 … Hired=4), clamped to [0, PRIOR_DEPTH_BAND]. So a final-round
 *  near-miss (Offer→3) floats above a day-one screen-out (Accepted→0) when their
 *  honest base scores fall within the band — and never otherwise.
 *
 *  Pure + deterministic (same stage → same boost, no state), so the band contract
 *  is unit-tested in isolation. An unknown/blank stage (index -1) or the shallow
 *  entry stage (Accepted, index 0) contributes 0 — a boost only ever HELPS a
 *  candidate we can place deeper on the axis; it never penalises. */
export function priorDepthBoost(stage: string | null | undefined): number {
  const idx = PIPELINE_STAGES.indexOf((stage ?? "") as (typeof PIPELINE_STAGES)[number]);
  if (idx <= 0) return 0;
  return Math.min(idx, PRIOR_DEPTH_BAND);
}

/** Comparator over ALREADY-ADMITTED rows: sort by honest base score PLUS the
 *  band-limited prior-depth boost, then by honest base score as a stable tiebreak
 *  (so two equal effective ranks keep the higher HONEST scorer first). The boost
 *  affects ORDER only — callers keep displaying `score`, the honest base. Because
 *  boost ∈ [0, PRIOR_DEPTH_BAND], if B's base score leads A's by more than the
 *  band, B stays ahead no matter the depths — the band is never crossed. */
export function byPriorAwareRank(
  a: { score: number; boost: number },
  b: { score: number; boost: number }
): number {
  return b.score + b.boost - (a.score + a.boost) || b.score - a.score;
}
