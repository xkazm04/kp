// The funnel band as a file.
//
// The brief's first band is the figure a hiring manager is asked to defend upward
// ("where does it stall, and against which goal"), and it was the one panel on the
// tab with no way off the screen — the roles table beside it and the decision log
// under it both export, so the reader had to screenshot the one band that carries
// the argument.
//
// Pure, and separate from PerformanceBriefing, for the same reason `economicsRows`
// is separate from its board: the part that can lie is the ABSENT case. A stage
// with no predecessor cohort has no conversion (`conversionPct: null`), and a stage
// the org set no goal for has no benchmark (`analyticsFunnelEmptyState` — a colour
// is a judgement, and the `?? 50` this tab used to judge against was a number
// nobody ever set). The screen prints an em dash for both. A CSV that quietly wrote
// `0%` there would re-introduce the fabricated zero one layer down, in the artifact
// that outlives the screen and gets pasted into a board deck.
import type { ConversionGoals, FunnelRow } from "./analyticsFunnelEmptyState";
import { withExportProvenance } from "./analyticsDecisionLogTypes";

/** Column headers, resolved by the caller so this module stays free of next-intl
 *  and can be driven directly by a test. */
export type FunnelCsvLabels = {
  stage: string;
  reached: string;
  current: string;
  conversion: string;
  goal: string;
};

/** Provenance labels for the funnel/roles files — same block the decision-log
 *  CSV already leads with, resolved by the caller. */
export type AnalyticsCsvProvLabels = {
  export: string;
  generated: string;
  window: string;
  tz: string;
  locale: string;
  truncated: string;
  excludedSim: string;
};

export type AnalyticsCsvMeta = {
  window: string;
  bucketTz: string;
  locale: string;
  truncated: boolean;
  excludedSim: number;
  truncatedNote?: string;
  excludedNote?: string;
  generatedAt?: string;
};

/** Scope block a manager's deck file must carry so it cannot disagree with the
 *  Analytics header about window, UTC, the cohort cap, or sim exclusion. */
export function analyticsCsvProvenance(
  exportName: string,
  meta: AnalyticsCsvMeta,
  labels: AnalyticsCsvProvLabels
): [string, string | number][] {
  const rows: [string, string | number][] = [
    [labels.export, exportName],
    [labels.generated, meta.generatedAt ?? new Date().toISOString()],
    [labels.window, meta.window],
    [labels.tz, meta.bucketTz],
    [labels.locale, meta.locale],
  ];
  if (meta.truncated) rows.push([labels.truncated, meta.truncatedNote ?? "truncated"]);
  if (meta.excludedSim > 0) rows.push([labels.excludedSim, meta.excludedNote ?? meta.excludedSim]);
  return rows;
}

/** The tab's one marker for "not measured" — the same glyph the funnel rows, the
 *  roles table and the economics board already print for this situation. */
const ABSENT = "—";

/**
 * Header row + one row per funnel stage, in the order the band renders them.
 *
 * `current` is on the file but not on the band's rows: the band spends its width
 * on the conversion argument, while a reader working the export offline wants to
 * know how many people are sitting in the stage right now. It is the same field
 * the dwell panel under the band renders, so the file adds a column the page
 * already states rather than a measurement it does not.
 */
export function funnelCsvRows(
  funnel: FunnelRow[],
  goals: ConversionGoals,
  labels: FunnelCsvLabels,
  stageLabel: (stage: string) => string,
  scope?: { provenance: [string, string | number][] }
): (string | number | null)[][] {
  const header = [labels.stage, labels.reached, labels.current, labels.conversion, labels.goal];
  const body = funnel.map((f) => {
    const goal = goals[f.stage];
    return [
      stageLabel(f.stage),
      f.reached,
      f.current,
      f.conversionPct == null ? ABSENT : `${f.conversionPct}%`,
      goal == null ? ABSENT : `${goal}%`,
    ];
  });
  if (!scope) return [header, ...body];
  return withExportProvenance(scope.provenance, header, body);
}

export type RoleCsvRow = {
  jobTitle: string;
  /** null = not attributable to this row (a title several reqs share, or a role-scoped
   *  read) — exported as the em dash, never as a zero. */
  koDeclined: number | null;
  total: number;
  reachedInterview: number;
  hired: number;
  hireRatePct: number;
};

export type RoleCsvLabels = {
  job: string;
  koDeclined: string;
  inPipeline: string;
  reachedInterview: string;
  hired: string;
  hireRate: string;
};

/** Roles table as a file. Same em-dash / provenance contract as the funnel. */
export function rolesCsvRows(
  rows: RoleCsvRow[],
  labels: RoleCsvLabels,
  scope?: { provenance: [string, string | number][] }
): (string | number | null)[][] {
  const header = [labels.job, labels.koDeclined, labels.inPipeline, labels.reachedInterview, labels.hired, labels.hireRate];
  const body = rows.map((j) => [
    j.jobTitle,
    j.koDeclined ?? ABSENT,
    j.total,
    j.reachedInterview,
    j.hired,
    j.total === 0 ? ABSENT : `${j.hireRatePct}%`,
  ]);
  if (!scope) return [header, ...body];
  return withExportProvenance(scope.provenance, header, body);
}
