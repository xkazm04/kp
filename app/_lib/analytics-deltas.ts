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

// A source/channel row's movement vs. the prior window (Direction 2 — "source
// effectiveness over time"). volume is a raw count diff (always defined once a row
// exists); conversionPct is the hire-rate movement, min-n gated so a rate swing on
// a handful of leads never reads as a trend. costPerApplicantCzk rides along for
// channels but is null in windowed views (spend is a lifetime total — see the DB
// layer's windowed-CPA honesty rule), so its delta is null there by construction.
export type SourceDelta = {
  source: string;
  volume: Delta;
  conversionPct: Delta;
};
export type ChannelDelta = {
  channel: string;
  volume: Delta;
  conversionPct: Delta;
  costPerApplicantCzk: Delta;
};

export type PeriodDeltas = {
  total: Delta;
  hired: Delta;
  hireRatePct: Delta;
  avgTimeToHireDays: Delta;
  funnel: { stage: string; conversionPct: Delta }[];
  // Per-source / per-channel movement, matched by name (not index) against the
  // prior window. Only the CURRENT window's rows get a delta; a source that
  // vanished entirely isn't re-listed (there's no current row to hang it on).
  bySource: SourceDelta[];
  byChannel: ChannelDelta[];
};

// Minimum leads in BOTH windows before a per-source/channel conversion delta is
// shown — a hire-rate movement computed off a couple of candidates is noise, not
// signal. Volume deltas (plain counts) are always safe and aren't gated.
export const MIN_RATE_DELTA_N = 5;

// The minimal slice of a PipelineAnalytics payload this module reads — declared
// locally so the module imports nothing.
type SourceSlice = { source: string; total: number; hireRatePct: number };
type ChannelSlice = { channel: string; total: number; hireRatePct: number; costPerApplicantCzk: number | null };
type AnalyticsSlice = {
  total: number;
  hired: number;
  avgTimeToHireDays: number | null;
  funnel: { stage: string; conversionPct: number | null }[];
  bySource: SourceSlice[];
  byChannel: ChannelSlice[];
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
  const priorSource = new Map(prior.bySource.map((r) => [r.source, r]));
  const priorChannel = new Map(prior.byChannel.map((r) => [r.channel, r]));
  // A rate is only comparable when BOTH windows cleared the min-n floor; below it
  // the side's rate reads null so diff() yields a null (suppressed) delta.
  const gatedRate = (total: number, rate: number): number | null => (total >= MIN_RATE_DELTA_N ? rate : null);
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
    bySource: current.bySource.map((r) => {
      const p = priorSource.get(r.source);
      return {
        source: r.source,
        // Volume: a source absent from the prior window genuinely had 0 leads then
        // (not "no baseline") — the "+N new from here" reading is meaningful.
        volume: diff(r.total, p?.total ?? 0),
        conversionPct: diff(gatedRate(r.total, r.hireRatePct), p ? gatedRate(p.total, p.hireRatePct) : null),
      };
    }),
    byChannel: current.byChannel.map((r) => {
      const p = priorChannel.get(r.channel);
      return {
        channel: r.channel,
        volume: diff(r.total, p?.total ?? 0),
        conversionPct: diff(gatedRate(r.total, r.hireRatePct), p ? gatedRate(p.total, p.hireRatePct) : null),
        // Spend is a lifetime total, so a windowed cohort has no honest per-period
        // CPA (the DB returns null in windowed views) — the delta is null there.
        costPerApplicantCzk: diff(r.costPerApplicantCzk, p?.costPerApplicantCzk ?? null),
      };
    }),
  };
}
