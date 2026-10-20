// The ONE cohort fold behind both sides of every period-over-period delta
// (challenge-r06 analytics-computation/A).
//
// pipelineAnalytics (the live battery) and pipelineAnalyticsPrior (the slim prior
// slice) used to carry two hand-kept copies of this fold — hired, the reach loop, the
// conversion ratio, the time-to-hire sample — held equal only by a deepEqual test. The
// test was written to preserve the full battery's behaviour, including a leak (the prior
// window's source read was lower-bound only, so it counted every CURRENT-window
// candidate). Folding both through one pure function, over windows derived from ONE
// clock, makes that class of drift unrepresentable.
//
// TWO RULES this module owns:
//
//  1. Windows are HALF-OPEN and TILE. `deltaWindows(now, days)` returns the current
//     window [now - days, now) and the prior window [now - 2·days, now - days) whose
//     end IS the current start — the same number, never a second Date.now(). An entry
//     created exactly at the boundary belongs to the window it starts.
//     (software-engineering/analytics-time-windows: half-open-interval-policy.)
//
//  2. A cohort is judged AS OF its window's end (`asOfMs`). A terminal row counts as
//     hired — and joins the time-to-hire sample — only when its terminal transition
//     (`stage_changed_at`, the stamp the time-to-hire math already reads) landed before
//     `asOfMs`. The live read passes +Infinity (every row as it stands — a hire stamped
//     in the read's own millisecond is still a hire), so nothing about it changes; the
//     prior window passes its own end, so both cohorts have had the same 0..N days to mature.
//     Without this, a 30-day view compared a cohort with at most 30 days to hire against
//     one with up to 60: the hire-rate delta read as a decline and the time-to-hire delta
//     as an improvement, every time, with no change in behaviour.
//     (recruiting/small-sample-honesty-in-hiring-analytics: state-the-accrual-horizon;
//     analytics-time-windows: cohort-matched-comparison.)
//
// STATED LIMIT: only the TERMINAL leg is age-matched. A stage-as-of read for the earlier
// columns needs the event ledger; the fold keeps their current-stage basis. A terminal
// row whose hire postdates `asOfMs` is folded as standing on the column immediately
// before its terminal one (it had not reached the terminal column yet, and that is the
// least it had reached under the current-stage basis). periodDeltas gates every rate on
// both sides' n, so those legs cannot turn into alarms on thin cohorts.
//
// A stamp that is missing or unparseable cannot be placed in time: such a terminal row
// stays a hire (it was seeded or moved by a path that leaves stage_changed_at alone —
// see db/pipeline.ts) and, as before, never joins the time-to-hire sample.
//
// Pure: imports only the DB-free stage-axis helpers.
import { screeningGateIndex, stageHasRole, stageIndex, type StageDef } from "./pipeline-stages";

export const DAY_MS = 86_400_000;

/** [start, endExclusive), in epoch ms. */
export type HalfOpenWindow = { start: number; endExclusive: number };

/** The lower bound of a `days`-long window ending at `endMs`. The ONE arithmetic every
 *  windowed read in the analytics store derives its cutoff from. */
export function windowStart(endMs: number, days: number): number {
  return endMs - days * DAY_MS;
}

/** The two windows a period delta compares, from one captured clock. `prior.endExclusive`
 *  is `current.start` by construction — the same number, not a recomputation. */
export function deltaWindows(nowMs: number, days: number): { current: HalfOpenWindow; prior: HalfOpenWindow } {
  const start = windowStart(nowMs, days);
  return {
    current: { start, endExclusive: nowMs },
    prior: { start: windowStart(start, days), endExclusive: start },
  };
}

/** The four ORIGIN buckets `bySource` reports, from an entry's EARLIEST pipeline event
 *  kind. Declared once — both windows bucket the same way. */
export function originOf(kind: string): string {
  if (kind === "applied") return "applied";
  if (kind === "matched") return "matched";
  if (kind === "added" || kind === "intake_degraded") return "added";
  return "other";
}

export type CohortRow = {
  stage: string;
  status: string;
  created_at: string | null;
  stage_changed_at: string | null;
  source_channel?: string | null;
};

export type CohortFunnelStage = { stage: string; reached: number; current: number; conversionPct: number | null };

export type CohortChannel = { channel: string; total: number; reachedInterview: number; hired: number; rejected: number; hireRatePct: number };

export type CohortFold = {
  total: number;
  hired: number;
  funnel: CohortFunnelStage[];
  /** The time-to-hire sample, in days (unrounded). */
  tthDays: number[];
  avgTimeToHireDays: number | null;
  /** tthDays.length — the n every time-to-hire statistic and delta must quote. */
  timeToHireSamples: number;
  /** Per stored source_channel, in first-seen order (rows without one are skipped). */
  byChannel: CohortChannel[];
};

type AsOf = { asOfMs: number };

function pct(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** The per-axis predicates one fold needs, resolved once. */
function axisView(axis: readonly StageDef[], asOfMs: number) {
  const isTerminal = (stage: string) => stageHasRole(stage, "terminal", axis);
  /** Terminal AND the terminal transition landed before asOf (or cannot be placed). */
  const hiredAsOf = (stage: string, changedAt: string | null | undefined): boolean => {
    if (!isTerminal(stage)) return false;
    const t = changedAt ? Date.parse(changedAt) : Number.NaN;
    return !(Number.isFinite(t) && t >= asOfMs);
  };
  /** The axis index the row stood on as of asOf: a terminal row not yet hired then is
   *  folded one column short of its terminal one (see the module header). */
  const effectiveIndex = (stage: string, changedAt: string | null | undefined): number => {
    const i = stageIndex(stage, axis);
    if (i < 0) return i;
    return isTerminal(stage) && !hiredAsOf(stage, changedAt) ? Math.max(0, i - 1) : i;
  };
  return { isTerminal, hiredAsOf, effectiveIndex, gateIdx: screeningGateIndex(axis) };
}

/** Fold one cohort's rows into the figures a period delta compares. */
export function foldCohort(rows: readonly CohortRow[], axis: readonly StageDef[], { asOfMs }: AsOf): CohortFold {
  const { hiredAsOf, effectiveIndex, gateIdx } = axisView(axis, asOfMs);
  const stageIds = axis.map((s) => s.id);

  const reached = stageIds.map(() => 0);
  const current = stageIds.map(() => 0);
  let hired = 0;
  const tthDays: number[] = [];
  const channels = new Map<string, { total: number; reachedInterview: number; hired: number; rejected: number }>();

  for (const r of rows) {
    const isHire = hiredAsOf(r.stage, r.stage_changed_at);
    if (isHire) {
      hired += 1;
      if (r.created_at && r.stage_changed_at) {
        const d = (Date.parse(r.stage_changed_at) - Date.parse(r.created_at)) / DAY_MS;
        // NaN (a malformed stamp) fails this test too, so it never poisons the mean.
        if (d >= 0) tthDays.push(d);
      }
    }
    const i = effectiveIndex(r.stage, r.stage_changed_at);
    if (i >= 0) {
      for (let k = 0; k <= i; k += 1) reached[k] += 1;
      if (r.status === "active") current[i] += 1;
    }
    if (r.source_channel) {
      const m = channels.get(r.source_channel) ?? { total: 0, reachedInterview: 0, hired: 0, rejected: 0 };
      m.total += 1;
      if (i >= gateIdx) m.reachedInterview += 1;
      if (isHire) m.hired += 1;
      if (r.status === "rejected") m.rejected += 1;
      channels.set(r.source_channel, m);
    }
  }

  const funnel = stageIds.map((stage, i) => ({
    stage,
    reached: reached[i],
    current: current[i],
    conversionPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
  }));

  return {
    total: rows.length,
    hired,
    funnel,
    tthDays,
    avgTimeToHireDays: tthDays.length ? Math.round(tthDays.reduce((a, b) => a + b, 0) / tthDays.length) : null,
    timeToHireSamples: tthDays.length,
    byChannel: [...channels.entries()].map(([channel, m]) => ({ channel, ...m, hireRatePct: pct(m.hired, m.total) })),
  };
}

export type SourceRow = { stage: string; kind: string; stage_changed_at?: string | null };
export type CohortSource = { source: string; total: number; reachedInterview: number; hired: number; hireRatePct: number };

/** Fold the first-event origin join's rows into `bySource`, with the same as-of rule.
 *  Sorted by volume, largest first (stable on ties). */
export function foldSources(rows: readonly SourceRow[], axis: readonly StageDef[], { asOfMs }: AsOf): CohortSource[] {
  const { hiredAsOf, effectiveIndex, gateIdx } = axisView(axis, asOfMs);
  const map = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of rows) {
    const key = originOf(r.kind);
    const m = map.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (effectiveIndex(r.stage, r.stage_changed_at) >= gateIdx) m.reachedInterview += 1;
    if (hiredAsOf(r.stage, r.stage_changed_at)) m.hired += 1;
    map.set(key, m);
  }
  return [...map.entries()]
    .map(([source, m]) => ({ source, ...m, hireRatePct: pct(m.hired, m.total) }))
    .sort((a, b) => b.total - a.total);
}
