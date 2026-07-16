import type { Analysis } from "@/app/_lib/schemas";
import { hasRenderableComparison, primaryScore } from "@/app/_lib/comparison";
import { reconcileScoreTotal } from "@/app/_lib/format";

// Direction 1 (verdict-above-the-fold) — the ONE resolution behind the leading
// verdict banner. The banner headlines the reconciled OVERALL score + its band
// (reconcileScoreTotal, the same component sum the ScoreDial and compare grid
// paint), with the job-fit score shown alongside when the run was JD-bound.
//
// On a multi-variant run the report defaults to the Compare tab, so the winner's
// verdict would otherwise never be above the fold. This resolves the WINNER by the
// SAME rule CompareTab crowns by — max `primaryScore` (imported from comparison.ts,
// not re-derived), earliest column on a tie (strict `>`) — so the banner and the
// crowned column can never disagree about who won. Pure + render-free so it
// unit-tests under `node --test`.
export type Verdict = {
  // The reconciled overall score (component sum), or null when it isn't a finite
  // number — an honest "unscored" state the banner degrades to WITHOUT inventing a
  // band, rather than painting a fabricated verdict.
  overall: number | null;
  // The job-fit score when the run was scored against a JD, else null (a JD-less
  // analysis, or a variant with no job-fit read).
  jobFit: number | null;
  // On a multi-variant comparison, the winning variant's label; null on a single
  // analysis (nothing was compared).
  winnerLabel: string | null;
};

export function resolveVerdict(analysis: Analysis): Verdict {
  const comparison = analysis.comparison;
  if (hasRenderableComparison(comparison)) {
    // The winner by INDEX via max primary score — the exact rule (and import) the
    // compare grid uses to crown its column, so the two can't pick different winners.
    let winnerIndex = 0;
    for (let i = 1; i < comparison.variants.length; i++) {
      if (primaryScore(comparison.variants[i]) > primaryScore(comparison.variants[winnerIndex])) {
        winnerIndex = i;
      }
    }
    const winner = comparison.variants[winnerIndex];
    const overall = reconcileScoreTotal(winner.score);
    return {
      overall: Number.isFinite(overall) ? overall : null,
      jobFit: winner.jobFitScore,
      winnerLabel: winner.label,
    };
  }
  const overall = reconcileScoreTotal(analysis.score);
  return {
    overall: Number.isFinite(overall) ? overall : null,
    jobFit: analysis.jobFit?.score ?? null,
    winnerLabel: null,
  };
}
