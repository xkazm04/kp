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
  // null when either side is null (can't form a baseline) OR the movement is withheld.
  delta: number | null;
  /** RATE deltas only: the denominator each side's figure stands on (cohort total for
   *  the hire rate, upstream reach for a funnel conversion, the sample for time-to-hire,
   *  leads for a source/channel). Absent on plain counts. */
  n?: { current: number; prior: number };
  /** RATE deltas only: why `delta` is null although both figures exist — a side below
   *  MIN_RATE_DELTA_N. Null when the movement is shown. A thin movement is withheld WITH
   *  its reason, never shown as a movement (small-sample honesty). */
  withheld?: DeltaWithheld | null;
};

export type DeltaWithheld = { reason: "thinCurrent" | "thinPrior" | "thinBoth"; minN: number };

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

// Minimum n in BOTH windows before ANY rate delta is shown — the headline hire rate
// (cohort total), each funnel conversion (upstream reach), time-to-hire (its sample)
// and each source/channel conversion (leads). A movement computed off a couple of
// candidates is noise, not signal. Volume deltas (plain counts) are always safe and
// aren't gated. (challenge-r06: the gate used to cover only source/channel rows, so the
// two chips a recruiter reads first moved on any n at all.)
export const MIN_RATE_DELTA_N = 5;

// The minimal slice of a PipelineAnalytics payload this module reads — declared
// locally so the module imports nothing.
type SourceSlice = { source: string; total: number; hireRatePct: number };
type ChannelSlice = { channel: string; total: number; hireRatePct: number; costPerApplicantCzk: number | null };
type AnalyticsSlice = {
  total: number;
  hired: number;
  avgTimeToHireDays: number | null;
  timeToHireSamples: number;
  funnel: { stage: string; reached: number; conversionPct: number | null }[];
  bySource: SourceSlice[];
  byChannel: ChannelSlice[];
};

function diff(current: number | null, prior: number | null): Delta {
  const delta = current != null && prior != null ? current - prior : null;
  return { current, prior, delta };
}

/** A RATE delta: diff() plus both sides' n, withheld when either side is thin. The
 *  figures themselves stay on the record (they are real); only the movement is not
 *  claimed. */
function gatedDiff(current: number | null, prior: number | null, nCurrent: number, nPrior: number): Delta {
  const thinC = nCurrent < MIN_RATE_DELTA_N;
  const thinP = nPrior < MIN_RATE_DELTA_N;
  const withheld: DeltaWithheld | null =
    thinC || thinP ? { reason: thinC && thinP ? "thinBoth" : thinC ? "thinCurrent" : "thinPrior", minN: MIN_RATE_DELTA_N } : null;
  const base = diff(current, prior);
  return { ...base, delta: withheld ? null : base.delta, n: { current: nCurrent, prior: nPrior }, withheld };
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
  // A conversion's n is the reach of the stage BEFORE it, on each side's own funnel
  // (matched by name, like the conversion itself).
  const upstream = (funnel: AnalyticsSlice["funnel"]) =>
    new Map(funnel.map((f, i) => [f.stage, i > 0 ? funnel[i - 1].reached : f.reached]));
  const priorConv = new Map(prior.funnel.map((f) => [f.stage, f.conversionPct]));
  const priorUp = upstream(prior.funnel);
  const currentUp = upstream(current.funnel);
  const priorSource = new Map(prior.bySource.map((r) => [r.source, r]));
  const priorChannel = new Map(prior.byChannel.map((r) => [r.channel, r]));
  // A source/channel rate is only comparable when BOTH windows cleared the min-n floor;
  // below it the side's rate reads null, as it always has, and the record says why.
  const gatedRate = (total: number, rate: number): number | null => (total >= MIN_RATE_DELTA_N ? rate : null);
  const rowRate = (cur: { total: number; hireRatePct: number }, p: { total: number; hireRatePct: number } | undefined): Delta =>
    gatedDiff(gatedRate(cur.total, cur.hireRatePct), p ? gatedRate(p.total, p.hireRatePct) : null, cur.total, p?.total ?? 0);
  return {
    total: diff(current.total, prior.total),
    hired: diff(current.hired, prior.hired),
    hireRatePct: gatedDiff(hireRate(current), hireRate(prior), current.total, prior.total),
    avgTimeToHireDays: gatedDiff(current.avgTimeToHireDays, prior.avgTimeToHireDays, current.timeToHireSamples, prior.timeToHireSamples),
    funnel: current.funnel.map((f) => ({
      stage: f.stage,
      // A stage absent from the prior window (Map.get → undefined) has no baseline.
      conversionPct: gatedDiff(f.conversionPct, priorConv.get(f.stage) ?? null, currentUp.get(f.stage) ?? 0, priorUp.get(f.stage) ?? 0),
    })),
    bySource: current.bySource.map((r) => {
      const p = priorSource.get(r.source);
      return {
        source: r.source,
        // Volume: a source absent from the prior window genuinely had 0 leads then
        // (not "no baseline") — the "+N new from here" reading is meaningful.
        volume: diff(r.total, p?.total ?? 0),
        conversionPct: rowRate(r, p),
      };
    }),
    byChannel: current.byChannel.map((r) => {
      const p = priorChannel.get(r.channel);
      return {
        channel: r.channel,
        volume: diff(r.total, p?.total ?? 0),
        conversionPct: rowRate(r, p),
        // Spend is a lifetime total, so a windowed cohort has no honest per-period
        // CPA (the DB returns null in windowed views) — the delta is null there.
        costPerApplicantCzk: diff(r.costPerApplicantCzk, p?.costPerApplicantCzk ?? null),
      };
    }),
  };
}
