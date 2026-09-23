// Everyone waiting in a stage RIGHT NOW, judged by the one aging clock
// (challenge-r05 analytics-metrics/B).
//
// WHY A SEPARATE READ. pipelineAnalytics folds its figures from the window's CREATION
// COHORT (entries created in the last N days). That is the right population for a
// funnel, and the wrong one for "who is waiting": in a 30-day view every active
// candidate created before the window vanished from the dwell band and from the
// bottleneck behind the funnel band's "stalled" claim — precisely the longest waiters —
// while the band's claim read "# candidates are waiting in a stage right now". The
// narrower the reader looked, the healthier the board seemed. This read ignores the
// window: its population is every ACTIVE entry of the workspace (and role, when the
// view is role-scoped), minus guided-demo residue, the same predicates the cohort read
// honours. It is an as-of-now figure, so it is never diffed against a prior window
// (analytics-deltas.ts carries no dwell delta).
//
// ONE CLOCK. Whole days and the tier come from aging-policy.ts (`daysInStageAt`,
// `agingTierAt`), the functions the board's amber dot, its ?quick=aging filter, the
// sidebar badge and the automation pass read. `pastCadence` counts every tier past
// "none" — aging AND stalled — because that is exactly the set ?quick=aging shows, so
// the count a row links from equals the cards the board opens on. The cadence is the
// team's `slaDays` on the axis when set (cadenceSource "team"), else the role default.
//
// THE PAIR, NOT A MEAN. Dwell is reported as the median of the current occupants plus
// the oldest one (the recruiting funnel-metrics standard): a mean of 2, 3 and 31 days
// reads "12", which describes nobody and hides the one who never exits. `avgDays` is
// still carried for readers of the older shape.
import { agingTier, daysInStageAt, slaForStage } from "../aging-policy";
import { stageHasRole, type StageDef } from "../pipeline-stages";
import { median } from "../stats";
import { SIM_TITLE_LIKE } from "@/app/features/shell/simulation/constants";
import { cadenceEditable, type DwellCadenceSource } from "@/app/features/insights/analytics/stageDwellGate";
import { ensureDb } from "./core";

export type StageDwellNowRow = {
  stage: string;
  count: number;
  avgDays: number;
  medianDays: number | null;
  oldestDays: number;
  pastCadence: number;
  stalled: number;
  cadenceDays: number;
  cadenceSource: DwellCadenceSource;
  cadenceEditable: boolean;
};

export type StageOccupant = { stage: string; stageChangedAt: string | null; createdAt: string | null };

/** Fold the current occupants into per-stage rows (axis order, stages with nobody
 *  waiting skipped, the terminal column excluded — a hire is not waiting) and the
 *  per-stage day arrays pickBottleneck ranks. Pure; `now` is the clock. An occupant
 *  standing on a column the axis no longer draws still feeds the bottleneck arrays
 *  (it IS waiting) but gets no row, as before. */
export function foldStageDwell(
  occupants: readonly StageOccupant[],
  axis: readonly StageDef[],
  now: number
): { rows: StageDwellNowRow[]; perStageDays: Record<string, number[]> } {
  const perStageDays: Record<string, number[]> = {};
  const past: Record<string, { past: number; stalled: number }> = {};
  for (const o of occupants) {
    if (stageHasRole(o.stage, "terminal", axis)) continue;
    // The board ages on stage_changed_at alone (an entry without one reads fresh);
    // the TIER follows it exactly. The day count falls back to created_at so an entry
    // that never moved still shows how long it has been sitting.
    const days = daysInStageAt(o.stageChangedAt ?? o.createdAt, now);
    if (days == null) continue;
    (perStageDays[o.stage] ??= []).push(Math.max(0, days));
    const tier = agingTier(o.stage, daysInStageAt(o.stageChangedAt, now), axis);
    const p = (past[o.stage] ??= { past: 0, stalled: 0 });
    if (tier !== "none") p.past += 1;
    if (tier === "stalled") p.stalled += 1;
  }
  const rows = axis.flatMap((def): StageDwellNowRow[] => {
    const arr = perStageDays[def.id];
    if (!arr || arr.length === 0) return [];
    const m = median(arr);
    const teamSet = def.role !== "terminal" && typeof def.slaDays === "number" && def.slaDays > 0;
    return [
      {
        stage: def.id,
        count: arr.length,
        avgDays: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
        medianDays: m === null ? null : Math.round(m),
        oldestDays: Math.max(...arr),
        pastCadence: past[def.id]?.past ?? 0,
        stalled: past[def.id]?.stalled ?? 0,
        cadenceDays: slaForStage(def.id, null, axis),
        cadenceSource: teamSet ? "team" : "default",
        cadenceEditable: cadenceEditable(def.id, axis),
      },
    ];
  });
  return { rows, perStageDays };
}

/** The as-of-now read: every active, non-demo entry of the workspace (and role). */
export function stageDwellNow(
  workspaceId: string,
  axis: readonly StageDef[],
  now: number,
  opts?: { jobId?: string | null }
): { rows: StageDwellNowRow[]; perStageDays: Record<string, number[]> } {
  const jobId = opts?.jobId ?? null;
  const occupants = ensureDb()
    .prepare(
      `SELECT stage, stage_changed_at AS stageChangedAt, created_at AS createdAt FROM pipeline_entries
        WHERE status = 'active' AND (job_title IS NULL OR job_title NOT LIKE ?) AND workspace_id = ?${jobId ? " AND job_id = ?" : ""}`
    )
    .all(SIM_TITLE_LIKE, workspaceId, ...(jobId ? [jobId] : [])) as StageOccupant[];
  return foldStageDwell(occupants, axis, now);
}
