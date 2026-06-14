// Period-over-period deltas for the analytics dashboard (idea-ce8e3c9e). The
// cohort window (30/90 days) only shows absolute values; a number without a
// baseline can't tell a recruiter whether hiring is improving or degrading — the
// comparison IS the insight. Given the SAME analytics payload computed for the
// current window and for the immediately-preceding window of equal length, diff
// the comparable scalars. Pure + import-free so the contract is unit-testable and
// the route can compose it over two pipelineAnalytics() calls.
//
// Only COHORT-based scalars are compared (counts, hire rate, funnel conversion,
// time-to-hire) — figures that are meaningful for a past cohort. As-of-now
// metrics (active age, the live bottleneck, momentum buckets) have no prior-window
// analogue and are deliberately left out of the diff.

export type Delta = {
  current: number | null;
  prior: number | null;
  // current - prior, in the figure's own unit (count, percentage POINTS, or days).
  // null when either side is null (can't form a baseline).
  delta: number | null;
};

export type PeriodDeltas = {
  total: Delta;
  hired: Delta;
  hireRatePct: Delta;
  avgTimeToHireDays: Delta;
  funnel: { stage: string; conversionPct: Delta }[];
};

// The minimal slice of a PipelineAnalytics payload this module reads — declared
// locally so the module imports nothing.
type AnalyticsSlice = {
  total: number;
  hired: number;
  avgTimeToHireDays: number | null;
  funnel: { stage: string; conversionPct: number | null }[];
};

function diff(current: number | null, prior: number | null): Delta {
  const delta = current != null && prior != null ? current - prior : null;
  return { current, prior, delta };
}

/** Overall hire rate as a whole-percent, or null when the cohort is empty (an
 *  undefined rate, not 0% — 0 hires of 0 candidates isn't "0% hire rate"). */
function hireRate(a: AnalyticsSlice): number | null {
  return a.total > 0 ? Math.round((a.hired / a.total) * 100) : null;
}

/** Diff the current-window analytics against the prior equal-length window. The
 *  prior funnel is matched by stage NAME (not index) so a future axis change can't
 *  silently misalign the conversion deltas. */
export function periodDeltas(current: AnalyticsSlice, prior: AnalyticsSlice): PeriodDeltas {
  const priorConv = new Map(prior.funnel.map((f) => [f.stage, f.conversionPct]));
  return {
    total: diff(current.total, prior.total),
    hired: diff(current.hired, prior.hired),
    hireRatePct: diff(hireRate(current), hireRate(prior)),
    avgTimeToHireDays: diff(current.avgTimeToHireDays, prior.avgTimeToHireDays),
    funnel: current.funnel.map((f) => ({
      stage: f.stage,
      // A stage absent from the prior window (Map.get → undefined) has no baseline.
      conversionPct: diff(f.conversionPct, priorConv.get(f.stage) ?? null),
    })),
  };
}
