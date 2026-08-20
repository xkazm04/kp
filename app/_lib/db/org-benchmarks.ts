import { ensureDb } from "./core";
import { screeningGateIndex, stageHasRole, stageIndex } from "../pipeline-stages";
import { getPipelineAxis } from "../pipeline-axis-server";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Cross-company reference tier (E0 Phase 2, tier-2) — org-wide AGGREGATE benchmarks a
// team compares itself against, computed by an org_id-JOIN across sibling teams. This is
// the ONE module that reads pipeline_entries ACROSS the workspace boundary on purpose:
// it returns ONLY aggregates (rates, a median, counts) — never a raw row, a candidate, or
// a team name — so no team can read or de-anonymize another's data. It is deliberately
// EXCLUDED from pipeline-tenancy.test.ts (which forbids unscoped pipeline_entries reads);
// its own guard is the k-ANONYMITY FLOOR below: a benchmark is withheld until enough
// teams AND entries contribute that no single team's figures are inferable from it.

// UAT KAT-ANA-5 — every figure below is ALL-TIME, and that is a decision, not an omission.
// The Analytics tab's 30/90-day cohort switcher is NOT threaded here: a windowed slice would
// fall under the k-anonymity floor (so the benchmark would vanish rather than narrow) and
// would bias medianTimeToHireDays low, because a short created-at cohort can only contain the
// hires that already finished. The reasoning is spelled out at app/api/benchmarks/route.ts;
// the scope is printed on screen by AnalyticsOrgBenchmarkPanel (orgBenchmark.scopeAllTime),
// and analyticsWindowScope.test.ts fails if the route grows a window param while the panel
// still claims all-time. A genuinely windowed benchmark needs its own basis, not a `days` arg.
export const BENCHMARK_MIN_ENTRIES = 20; // too small a sample is noise, not a benchmark
export const BENCHMARK_MIN_TEAMS = 2; // k-anonymity: an org benchmark is never a window onto ONE other team


export type HiringStats = {
  totalEntries: number;
  interviewRatePct: number; // reached Interview+ / total
  hireRatePct: number; // reached Hired / total
  medianTimeToHireDays: number | null; // median created→Hired days, over hired entries (null if none)
};

export type OrgHiringBenchmark = HiringStats & {
  available: boolean; // false ⇒ withheld: below the k-anonymity floor
  contributingTeams: number;
};

type StatRow = { stage: string; created_at: string | null; stage_changed_at: string | null; workspace_id: string };

function statsFrom(rows: StatRow[]): HiringStats {
  const total = rows.length;
  if (total === 0) return { totalEntries: 0, interviewRatePct: 0, hireRatePct: 0, medianTimeToHireDays: null };
  // This is the ONE aggregate that spans teams, and teams may run DIFFERENT
  // boards — one team's "Onsite" is another's "Interview", and neither name means
  // anything to the other. Each row is therefore judged against ITS OWN team's
  // axis, resolved once per team rather than per row. Reading one shared axis (as
  // this did) silently counted a renamed column as "never reached interview",
  // which is exactly the kind of quiet wrong number a benchmark must not produce.
  const axisFor = new Map<string, ReturnType<typeof getPipelineAxis>["stages"]>();
  const teamAxis = (workspaceId: string) => {
    let axis = axisFor.get(workspaceId);
    if (!axis) {
      axis = getPipelineAxis(workspaceId).stages;
      axisFor.set(workspaceId, axis);
    }
    return axis;
  };
  let reachedInterview = 0;
  let hired = 0;
  const tthDays: number[] = [];
  for (const r of rows) {
    const axis = teamAxis(r.workspace_id);
    const idx = stageIndex(r.stage, axis);
    if (idx >= 0 && idx >= screeningGateIndex(axis)) reachedInterview += 1;
    if (stageHasRole(r.stage, "terminal", axis)) {
      hired += 1;
      if (r.created_at && r.stage_changed_at) {
        const days = (Date.parse(r.stage_changed_at) - Date.parse(r.created_at)) / 86_400_000;
        if (Number.isFinite(days) && days >= 0) tthDays.push(days);
      }
    }
  }
  tthDays.sort((a, b) => a - b);
  let median: number | null = null;
  if (tthDays.length) {
    const mid = Math.floor(tthDays.length / 2);
    median = tthDays.length % 2 ? tthDays[mid] : (tthDays[mid - 1] + tthDays[mid]) / 2;
  }
  return {
    totalEntries: total,
    interviewRatePct: Math.round((reachedInterview / total) * 100),
    hireRatePct: Math.round((hired / total) * 100),
    medianTimeToHireDays: median == null ? null : Math.round(median),
  };
}

/** The org a team belongs to (null if the team row is missing an org). */
export function orgIdForWorkspace(workspaceId: string = DEFAULT_WORKSPACE_ID): string | null {
  const r = ensureDb().prepare(`SELECT org_id FROM workspaces WHERE id = ?`).get(workspaceId) as { org_id?: string | null } | undefined;
  return r?.org_id ?? null;
}

/** One team's OWN hiring stats — its pipeline only (workspace-scoped). */
export function teamHiringStats(workspaceId: string = DEFAULT_WORKSPACE_ID): HiringStats {
  const rows = ensureDb()
    .prepare(`SELECT stage, created_at, stage_changed_at, workspace_id FROM pipeline_entries WHERE workspace_id = ?`)
    .all(workspaceId) as StatRow[];
  return statsFrom(rows);
}

/** The org-wide AGGREGATE across the org's sibling teams (org_id-join), WITHHELD below
 *  the k-anonymity floor. Aggregate-only — the returned object never carries a row or a
 *  team identity. `excludeWorkspaceId` yields a "vs peers" benchmark (the org minus the
 *  caller's own team) when the org has enough OTHER teams to stay anonymous. */
export function orgHiringBenchmark(orgId: string, opts?: { excludeWorkspaceId?: string }): OrgHiringBenchmark {
  const db = ensureDb();
  const params: unknown[] = [orgId];
  let extra = "";
  if (opts?.excludeWorkspaceId) {
    extra = " AND pe.workspace_id != ?";
    params.push(opts.excludeWorkspaceId);
  }
  const rows = db
    .prepare(
      `SELECT pe.stage, pe.created_at, pe.stage_changed_at, pe.workspace_id
         FROM pipeline_entries pe JOIN workspaces w ON w.id = pe.workspace_id
        WHERE w.org_id = ?${extra}`
    )
    .all(...params) as StatRow[];
  const contributingTeams = new Set(rows.map((r) => r.workspace_id)).size;
  const stats = statsFrom(rows);
  const available = stats.totalEntries >= BENCHMARK_MIN_ENTRIES && contributingTeams >= BENCHMARK_MIN_TEAMS;
  // Below the floor we still report HOW MANY teams contributed (a count of teams is
  // not de-anonymizing — it's what the locked panel prints), but withhold the
  // rates/median so a 1-team org can't read the other team's figures off its own
  // "org" benchmark.
  //
  // `totalEntries` used to ride out of here unwithheld, and that reopened the exact
  // hole the self-exclusion above closed. In a 2-team org the caller is excluded, so
  // the aggregate has ONE contributor: `{ available: false, contributingTeams: 1,
  // totalEntries: 137 }` told team A that team B has exactly 137 candidates in its
  // pipeline. A volume is a team figure like any other once only one team fed it, and
  // the whole payload crosses the wire (GET /api/benchmarks returns it verbatim) even
  // though the locked panel renders only the team count. So the size is withheld on
  // the same condition the rates are — a lone contributor — and survives as a real
  // aggregate the moment ≥ BENCHMARK_MIN_TEAMS teams stand behind it.
  if (!available) {
    const anonymousTotal = contributingTeams >= BENCHMARK_MIN_TEAMS ? stats.totalEntries : 0;
    return { available: false, contributingTeams, totalEntries: anonymousTotal, interviewRatePct: 0, hireRatePct: 0, medianTimeToHireDays: null };
  }
  return { ...stats, available: true, contributingTeams };
}

export type TeamBenchmarkResponse = { team: HiringStats; org: OrgHiringBenchmark };

/** The /api/benchmarks payload for ONE calling team: its own hiring stats plus the
 *  org AGGREGATE. The aggregate is computed with the caller's OWN workspace EXCLUDED
 *  (the "vs peers" mode) so the k-anonymity floor (BENCHMARK_MIN_TEAMS) counts only
 *  OTHER teams. bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #3): with the
 *  caller included, a 2-team org (caller + one peer) let the caller subtract its OWN
 *  known stats from the "org" aggregate and back out the lone peer's figures — a
 *  de-anonymization the module's invariant forbids. Excluding self means "the org" a
 *  team sees is always ≥ BENCHMARK_MIN_TEAMS UNKNOWN teams, and the comparison is no
 *  longer diluted by the team measuring itself against itself. */
export function teamBenchmark(workspaceId: string = DEFAULT_WORKSPACE_ID): TeamBenchmarkResponse {
  const team = teamHiringStats(workspaceId);
  const orgId = orgIdForWorkspace(workspaceId);
  const org: OrgHiringBenchmark = orgId
    ? orgHiringBenchmark(orgId, { excludeWorkspaceId: workspaceId })
    : { available: false, contributingTeams: 0, totalEntries: 0, interviewRatePct: 0, hireRatePct: 0, medianTimeToHireDays: null };
  return { team, org };
}
