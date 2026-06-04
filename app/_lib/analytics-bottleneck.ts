// The bottleneck pick for the Insights tab (idea-bdaf9b2c). Pure + dependency-free
// so the small-sample policy is unit-testable in isolation (analytics-bottleneck.test.ts)
// without standing up a DB. db.ts feeds it the per-stage days-in-stage arrays.
//
// Why a guard: the amber bottleneck banner directs recruiter attention, so a
// confident "candidates in X have waited N days on average" backed by a single
// stale entry (n=1) erodes trust and misdirects effort. We require a minimum
// number of active entries before a stage can be called a systemic bottleneck,
// AND surface the sample size so the claim is legible, not a black box.

/** Minimum active entries in a stage before its average wait can be reported as
 *  a bottleneck. Below this, one outlier would masquerade as a trend. */
export const BOTTLENECK_MIN_SAMPLE = 3;

export type Bottleneck = { stage: string; avgDaysInStage: number; entryCount: number };

/** The stage with the highest average days-in-stage, considering only stages
 *  with at least `minSample` active entries. Returns null when no stage clears
 *  the bar — so the UI shows nothing rather than a confident n=1 claim. */
export function pickBottleneck(
  perStageDays: Record<string, number[]>,
  minSample: number = BOTTLENECK_MIN_SAMPLE
): Bottleneck | null {
  let best: Bottleneck | null = null;
  let bestAvg = -Infinity;
  for (const [stage, days] of Object.entries(perStageDays)) {
    if (days.length < minSample) continue; // too few to be systemic
    const avg = days.reduce((a, b) => a + b, 0) / days.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = { stage, avgDaysInStage: Math.round(avg), entryCount: days.length };
    }
  }
  return best;
}
