import { pickBottleneck, type Bottleneck } from "../analytics-bottleneck";
import { MOMENTUM_EVENT_KINDS, MOMENTUM_WEEKS, weeklyMomentum, type MomentumWeek } from "../analytics-momentum";
import { summarizeAutomationImpact, type AutomationImpact } from "../decision-attribution";
import { automationRoi, type AutomationRoi } from "../automation-roi";
import { FUNNEL_STAGES, hasAdvancedPastScreening, type FunnelStage } from "../pipeline-stages";
import { SIM_TITLE_LIKE } from "@/app/features/simulation/constants";
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { listChannelSpend } from "./channels";

// gsim-l2-105 / REC-11 — live aggregates must not count guided-demo residue: the
// simulation writes REAL pipeline rows and events whose job_title carries the
// (SIM) marker (the same single-sourced key resetSim purges by). Every cohort and
// event query in pipelineAnalytics excludes them, so a demo run can never move a
// leadership metric ("hired this week", funnel, ROI, cost-per-hire). NULL-safe on
// purpose: entries/events without a job title are real data and are kept. The
// sim's own reads go through listPipeline / the board, which stay unfiltered.
const notSim = (col = "job_title") => `(${col} IS NULL OR ${col} NOT LIKE ?)`;

// E5 — pure funnel-economics rules (median math, the 72h variant pause
// heuristic); fed below by pipelineAnalytics with the windowed rows.
import {
  medianHours,
  variantPauseRecommendations,
  type VariantRecommendation,
  type VariantStat,
} from "../source-analytics";

// ---- Pipeline analytics (Insights tab) ------------------------------------
// Snapshot-based so it stays correct even when the event history is sparse: an
// entry "reached" every stage up to its current one; durations come from the
// created_at / stage_changed_at pair we already maintain.

export type PipelineAnalytics = {
  total: number;
  active: number;
  hired: number;
  // Two DISTINCT terminal closes (see pipeline-status.ts): `rejected` = the
  // company passed; `declined` = the candidate turned down an offer. Kept
  // separate so offer-acceptance / re-engagement metrics aren't muddied by
  // lumping candidate declines into recruiter rejects.
  rejected: number;
  declined: number;
  funnel: { stage: string; reached: number; current: number; conversionPct: number | null }[];
  avgTimeToHireDays: number | null;
  // UAT M7 — blended overall cost per hire (Σ recruiter-entered channel spend ÷
  // hires), all-time only (windowed = null, mirroring the per-channel rule); the
  // single cost figure for the leadership readout.
  costPerHireCzk: number | null;
  avgAgeDays: number | null;
  bottleneck: Bottleneck | null;
  // Per-stage average dwell time across ALL active stages (Sloneek "time spent in
  // each hiring stage"), ordered Accepted-first. `bottleneck` surfaces only the
  // single worst stage; this is the full breakdown the same perStageDays feeds.
  // Excludes terminal Hired (no dwell) and stages with no active entries.
  stageDwell: { stage: string; avgDays: number; count: number }[];
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number; koDeclined: number }[];
  // Distinct job count before the byJob cap, so the UI can show "top N of M".
  byJobTotal: number;
  // E2/ANA — applicants turned away at the eligibility (KO) gate BEFORE any
  // pipeline entry existed. Counted from the entry-less ko_declined events the
  // intake gate has always audited; without this the top-of-funnel loss was
  // recorded but invisible everywhere.
  koDeclined: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  // ANA2 — the window actually applied (null = all time), echoed so the client
  // renders the selector state from the server's answer, not its own request.
  windowDays: number | null;
  // ANA2 — weekly inflow/outcome trend from pipeline_events (see
  // analytics-momentum.ts for the series mapping and bucket semantics).
  momentum: MomentumWeek[];
  // ANA3 — automation-vs-human rollup over the same window, folded through the
  // shared decision-attribution map the DecisionLog badges use.
  automation: AutomationImpact;
  // b39992b1 — counterfactual ROI: the recruiter-hours + CZK the automated event
  // trail saved over the window, at the org's (or default) hourly rate.
  automationRoi: AutomationRoi;
  // ANA4 — channel effectiveness: entries grouped by ORIGIN, derived from each
  // entry's earliest pipeline_events kind (applied = inbound apply, matched =
  // match fan-out/sourcing, added = recruiter manual/intake). No migration —
  // origin is derived, never stored.
  bySource: { source: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  // E5 — funnel economics over the STORED source_channel (E3 attribution):
  // conversion per inbound channel, median hours from entry to first decision
  // event, and recruiter-entered spend → cost per applicant / per hire.
  byChannel: ChannelEconomics[];
  // E5 — per-(job × campaign × variant) creative performance (capped top-N by
  // volume; byVariantTotal is the true count) + the 72h pause recommendations.
  byVariant: VariantStat[];
  byVariantTotal: number;
  variantRecommendations: VariantRecommendation[];
  // 82c2b8e8 — recruiter-set goals: per-stage conversion %% targets (keyed by
  // stage name) + a single time-to-hire target in days. Goal lines on the funnel
  // and the goal-aware miss flagging read from here; empty when nothing is set.
  targets: { conversion: Record<string, number>; timeToHireDays: number | null };
};

// 82c2b8e8 — the reserved analytics_targets row whose value is a time-to-hire
// goal in DAYS (every other row is a funnel stage name → conversion %% target).
export const TIME_TO_HIRE_TARGET_KEY = "time_to_hire";

// b39992b1 — the reserved analytics_targets row holding the org's recruiter hourly
// cost (CZK) for the automation ROI figure. Not a "goal" — but it rides the same
// key/value table + save route, so it lives alongside the goal keys and is
// filtered out of the conversion-goal map.
export const RECRUITER_HOURLY_TARGET_KEY = "recruiter_hourly_czk";

export type ChannelEconomics = {
  channel: string;
  total: number;
  reachedInterview: number;
  hired: number;
  rejected: number;
  hireRatePct: number;
  medianHoursToDecision: number | null;
  spendCzk: number | null;
  costPerApplicantCzk: number | null;
  costPerHireCzk: number | null;
};

// ANA2 — `windowDays` scopes the snapshot metrics to the COHORT of entries
// created in the last N days (entries with no created_at drop out of a windowed
// view); omitted/null keeps the historical all-time behavior. Cohort-by-entry —
// not event-replay — so every figure keeps its existing meaning, just over the
// recent population.
export function pipelineAnalytics(
  windowDays?: number | null,
  // ce8e3c9e — `endMs` upper-bounds the cohort so the period-over-period diff can
  // request the PRIOR window: pipelineAnalytics(N, { endMs: Date.now() - N*DAY })
  // yields the cohort created in [endMs - N*DAY, endMs). Omitted = the live
  // window ending now (byte-identical to the historical single-arg behavior). The
  // upper bound only scopes the cohort SELECT — as-of-now figures (age, momentum)
  // stay real-time and are not diffed (see analytics-deltas.ts).
  opts?: { endMs?: number },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineAnalytics {
  const db = ensureDb();
  const endMs = opts?.endMs ?? Date.now();
  const cutoffIso = windowDays ? new Date(endMs - windowDays * 86_400_000).toISOString() : null;
  const upperIso = opts?.endMs != null && windowDays ? new Date(endMs).toISOString() : null;
  const ROW_COLUMNS =
    "job_id, job_title, archetype, stage, status, created_at, stage_changed_at, source_channel, source_campaign, source_variant";
  const rows = (
    cutoffIso
      ? upperIso
        ? db
            .prepare(`SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE created_at >= ? AND created_at < ? AND ${notSim()} AND workspace_id = ?`)
            .all(cutoffIso, upperIso, SIM_TITLE_LIKE, workspaceId)
        : db.prepare(`SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE created_at >= ? AND ${notSim()} AND workspace_id = ?`).all(cutoffIso, SIM_TITLE_LIKE, workspaceId)
      : db.prepare(`SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE ${notSim()} AND workspace_id = ?`).all(SIM_TITLE_LIKE, workspaceId)
  ) as {
    job_id: string | null;
    job_title: string | null;
    archetype: string | null;
    stage: string;
    status: string;
    created_at: string | null;
    stage_changed_at: string | null;
    source_channel: string | null;
    source_campaign: string | null;
    source_variant: string | null;
  }[];

  // Index against FUNNEL_STAGES (= the 5 canonical stages, Accepted-first). The
  // by-job/by-archetype thresholds below compare against idxOf("Interview") /
  // idxOf("Screened") symbolically, so they stay correct if the axis shifts.
  const idxOf = (s: string) => FUNNEL_STAGES.indexOf(s as FunnelStage);
  const now = Date.now();
  const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    // A blank/malformed timestamp parses to NaN; skip it rather than letting
    // NaN poison avgAgeDays / the bottleneck average downstream.
    return Number.isFinite(ms) ? Math.max(0, (now - ms) / 86_400_000) : null;
  };

  const total = rows.length;
  const hired = rows.filter((r) => r.stage === "Hired").length;
  // Now that declines carry their own status, `rejected` counts only company-side
  // passes; `declined` is the candidate-side close that used to be folded in.
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const declined = rows.filter((r) => r.status === "declined").length;
  const active = rows.filter((r) => r.status === "active" && r.stage !== "Hired").length;

  const reached = FUNNEL_STAGES.map(() => 0);
  const current = FUNNEL_STAGES.map(() => 0);
  for (const r of rows) {
    const i = idxOf(r.stage);
    if (i < 0) continue;
    for (let k = 0; k <= i; k += 1) reached[k] += 1;
    if (r.status === "active") current[i] += 1;
  }
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    reached: reached[i],
    current: current[i],
    conversionPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
  }));

  const tth = rows
    .filter((r) => r.stage === "Hired" && r.created_at && r.stage_changed_at)
    .map((r) => (Date.parse(r.stage_changed_at as string) - Date.parse(r.created_at as string)) / 86_400_000)
    .filter((d) => d >= 0);
  const avgTimeToHireDays = tth.length ? Math.round(tth.reduce((a, b) => a + b, 0) / tth.length) : null;

  const ages = rows
    .filter((r) => r.status === "active" && r.created_at)
    .map((r) => daysSince(r.created_at))
    .filter((d): d is number => d != null);
  const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;

  const perStageDays: Record<string, number[]> = {};
  for (const r of rows) {
    if (r.status !== "active" || r.stage === "Hired") continue;
    const d = daysSince(r.stage_changed_at ?? r.created_at);
    if (d != null) (perStageDays[r.stage] ??= []).push(d);
  }
  // Small-sample guard: a stage needs >= BOTTLENECK_MIN_SAMPLE active entries
  // before its average wait counts as a systemic bottleneck, so a lone stale
  // entry can't masquerade as a trend in the amber banner (idea-bdaf9b2c).
  const bottleneck = pickBottleneck(perStageDays);
  // Full per-stage dwell breakdown (the table beside the single-worst bottleneck
  // banner), ordered canonically and skipping stages with no active entries.
  const stageDwell = FUNNEL_STAGES.flatMap((stage) => {
    const arr = perStageDays[stage];
    if (!arr || arr.length === 0) return [];
    return [{ stage, avgDays: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), count: arr.length }];
  });

  const jobMap = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of rows) {
    const key = r.job_title ?? "—";
    const m = jobMap.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= idxOf("Interview")) m.reachedInterview += 1;
    if (r.stage === "Hired") m.hired += 1;
    jobMap.set(key, m);
  }
  // KO discards are entry-less events (recordKnockoutDecline) — the windowed
  // count is the funnel's invisible top-of-funnel loss. Grouped by job_title so
  // the role table can answer "how many applicants did this role's ad turn away
  // at eligibility?"; a role with KO discards but no entries still gets a row.
  const koRows = (
    cutoffIso
      ? db
          .prepare(`SELECT job_title, COUNT(*) AS n FROM pipeline_events WHERE kind='ko_declined' AND created_at >= ? AND ${notSim()} AND workspace_id = ? GROUP BY job_title`)
          .all(cutoffIso, SIM_TITLE_LIKE, workspaceId)
      : db.prepare(`SELECT job_title, COUNT(*) AS n FROM pipeline_events WHERE kind='ko_declined' AND ${notSim()} AND workspace_id = ? GROUP BY job_title`).all(SIM_TITLE_LIKE, workspaceId)
  ) as { job_title: string | null; n: number }[];
  const koByJob = new Map(koRows.map((r) => [r.job_title ?? "—", r.n]));
  const koDeclined = koRows.reduce((s, r) => s + r.n, 0);
  for (const jobTitle of koByJob.keys()) {
    if (!jobMap.has(jobTitle)) jobMap.set(jobTitle, { total: 0, reachedInterview: 0, hired: 0 });
  }
  // Cap the role table to the highest-volume jobs, but report the true distinct-job
  // count alongside it so the UI can say "top N of M" — a silently truncated table
  // would otherwise read as "these are all my roles" for larger orgs.
  const BY_JOB_CAP = 12;
  const byJobTotal = jobMap.size;
  const byJob = [...jobMap.entries()]
    .map(([jobTitle, m]) => ({
      jobTitle,
      total: m.total,
      reachedInterview: m.reachedInterview,
      hired: m.hired,
      hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
      koDeclined: koByJob.get(jobTitle) ?? 0,
    }))
    .sort((a, b) => b.total - a.total || b.koDeclined - a.koDeclined)
    .slice(0, BY_JOB_CAP);

  const archMap = new Map<string, { total: number; hired: number; advanced: number }>();
  for (const r of rows) {
    const key = r.archetype ?? "bau";
    const m = archMap.get(key) ?? { total: 0, hired: 0, advanced: 0 };
    m.total += 1;
    if (r.stage === "Hired") m.hired += 1;
    // "advanced past screening" = reached Interview or beyond (see
    // hasAdvancedPastScreening); a candidate AT Screened has not advanced past it.
    if (hasAdvancedPastScreening(r.stage)) m.advanced += 1;
    archMap.set(key, m);
  }
  const byArchetype = [...archMap.entries()]
    .map(([archetype, m]) => ({
      archetype,
      total: m.total,
      hired: m.hired,
      advanceRatePct: m.total ? Math.round((m.advanced / m.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Momentum trend (ANA2): the windowed view shows ceil(window/7) weekly buckets
  // so the bars span exactly the period the rest of the page describes; all-time
  // shows the default trailing MOMENTUM_WEEKS. Events are fetched only for the
  // span the buckets cover (created_at is indexed).
  const momentumWeeks = windowDays ? Math.max(1, Math.ceil(windowDays / 7)) : MOMENTUM_WEEKS;
  const momentumCutoff = new Date(Date.now() - momentumWeeks * 7 * 86_400_000).toISOString();
  const momentumKindList = `(${MOMENTUM_EVENT_KINDS.map((k) => `'${k}'`).join(", ")})`; // compile-time literals
  const momentumRows = db
    .prepare(
      `SELECT kind, to_stage, created_at FROM pipeline_events
        WHERE created_at >= ? AND kind IN ${momentumKindList} AND ${notSim()} AND workspace_id = ?`
    )
    .all(momentumCutoff, SIM_TITLE_LIKE, workspaceId) as { kind: string; to_stage: string | null; created_at: string }[];
  const momentum = weeklyMomentum(
    momentumRows.map((r) => ({ kind: r.kind, toStage: r.to_stage, createdAt: r.created_at })),
    { weeks: momentumWeeks }
  );

  // Automation impact (ANA3): one GROUP BY kind over the window (the fold
  // through the shared attribution map happens in pure, tested code), plus a
  // per-entry holds query — an entry counts RESOLVED when some decision event
  // (advance / reject / auto-reject) landed AFTER its first in-window hold.
  const kindCountRows = (
    cutoffIso
      ? db.prepare(`SELECT kind, COUNT(*) AS c FROM pipeline_events WHERE created_at >= ? AND ${notSim()} AND workspace_id = ? GROUP BY kind`).all(cutoffIso, SIM_TITLE_LIKE, workspaceId)
      : db.prepare(`SELECT kind, COUNT(*) AS c FROM pipeline_events WHERE ${notSim()} AND workspace_id = ? GROUP BY kind`).all(SIM_TITLE_LIKE, workspaceId)
  ) as { kind: string; c: number }[];
  const kindCounts = Object.fromEntries(kindCountRows.map((r) => [r.kind, r.c]));
  const holdRow = db
    .prepare(
      `SELECT COUNT(*) AS raised,
              SUM(EXISTS (
                SELECT 1 FROM pipeline_events e2
                 WHERE e2.entry_id = h.entry_id
                   AND e2.kind IN ('advanced', 'auto_advanced', 'rejected', 'auto_rejected')
                   AND e2.created_at > h.first_hold
              )) AS resolved
         FROM (
           SELECT entry_id, MIN(created_at) AS first_hold
             FROM pipeline_events
            WHERE kind = 'screening_hold' AND entry_id IS NOT NULL AND ${notSim()} AND workspace_id = ?
              ${cutoffIso ? "AND created_at >= ?" : ""}
            GROUP BY entry_id
         ) h`
    )
    .get(SIM_TITLE_LIKE, workspaceId, ...(cutoffIso ? [cutoffIso] : [])) as { raised: number; resolved: number | null };
  const automation = summarizeAutomationImpact(kindCounts, {
    raised: holdRow.raised,
    resolved: holdRow.resolved ?? 0,
  });

  // Source effectiveness (ANA4): each entry's FIRST event names how it entered
  // the pipeline (MIN(id) — insertion order — as the earliest-event proxy).
  // Same cohort window as the rest of the page. Entries with no events (legacy)
  // simply don't join — they have no derivable origin.
  // The earliest-event subquery is scoped to THIS workspace (and sim-filtered, like
  // the outer query): without it, `SELECT MIN(id) ... GROUP BY entry_id` scanned the
  // entire cross-workspace events table on every request just to find first-events
  // that the outer p.workspace_id join then discards. Scoping keeps the result
  // identical (an entry's events share its workspace) while bounding the scan.
  const sourceRows = (
    cutoffIso
      ? db
          .prepare(
            `SELECT p.stage AS stage, fe.kind AS kind
               FROM pipeline_entries p
               JOIN (SELECT entry_id, kind FROM pipeline_events
                      WHERE id IN (SELECT MIN(id) FROM pipeline_events
                                    WHERE entry_id IS NOT NULL AND ${notSim()} AND workspace_id = ? GROUP BY entry_id)
                    ) fe ON fe.entry_id = p.id
              WHERE p.created_at >= ? AND ${notSim("p.job_title")} AND p.workspace_id = ?`
          )
          .all(SIM_TITLE_LIKE, workspaceId, cutoffIso, SIM_TITLE_LIKE, workspaceId)
      : db
          .prepare(
            `SELECT p.stage AS stage, fe.kind AS kind
               FROM pipeline_entries p
               JOIN (SELECT entry_id, kind FROM pipeline_events
                      WHERE id IN (SELECT MIN(id) FROM pipeline_events
                                    WHERE entry_id IS NOT NULL AND ${notSim()} AND workspace_id = ? GROUP BY entry_id)
                    ) fe ON fe.entry_id = p.id
              WHERE ${notSim("p.job_title")} AND p.workspace_id = ?`
          )
          .all(SIM_TITLE_LIKE, workspaceId, SIM_TITLE_LIKE, workspaceId)
  ) as { stage: string; kind: string }[];
  const originOf = (kind: string): string =>
    kind === "applied" ? "applied" : kind === "matched" ? "matched" : kind === "added" || kind === "intake_degraded" ? "added" : "other";
  const sourceMap = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of sourceRows) {
    const key = originOf(r.kind);
    const m = sourceMap.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= idxOf("Interview")) m.reachedInterview += 1;
    if (r.stage === "Hired") m.hired += 1;
    sourceMap.set(key, m);
  }
  const bySource = [...sourceMap.entries()]
    .map(([source, m]) => ({
      source,
      total: m.total,
      reachedInterview: m.reachedInterview,
      hired: m.hired,
      hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // E5 — channel economics over the STORED source_channel (E3). Same windowed
  // cohort as the rest of the page; entries without attribution (recruiter/
  // Match-sourced, legacy) simply don't appear — bySource above covers them.
  const channelMap = new Map<string, { total: number; reachedInterview: number; hired: number; rejected: number }>();
  for (const r of rows) {
    if (!r.source_channel) continue;
    const m = channelMap.get(r.source_channel) ?? { total: 0, reachedInterview: 0, hired: 0, rejected: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= idxOf("Interview")) m.reachedInterview += 1;
    if (r.stage === "Hired") m.hired += 1;
    if (r.status === "rejected") m.rejected += 1;
    channelMap.set(r.source_channel, m);
  }
  // Median time from entry creation to the FIRST decision event (advance or
  // reject, human or policy) — the per-channel "how fast do we actually decide"
  // figure. One grouped query; the median itself is pure (source-analytics).
  const decisionRows = db
    .prepare(
      `SELECT p.source_channel AS channel, p.created_at AS created, MIN(e.created_at) AS decided
         FROM pipeline_entries p
         JOIN pipeline_events e
           ON e.entry_id = p.id AND e.kind IN ('advanced', 'auto_advanced', 'rejected', 'auto_rejected')
        WHERE p.source_channel IS NOT NULL AND ${notSim("p.job_title")} AND p.workspace_id = ? ${cutoffIso ? "AND p.created_at >= ?" : ""}
        GROUP BY p.id`
    )
    .all(SIM_TITLE_LIKE, workspaceId, ...(cutoffIso ? [cutoffIso] : [])) as { channel: string; created: string | null; decided: string }[];
  const decisionMsByChannel = new Map<string, number[]>();
  for (const r of decisionRows) {
    if (!r.created) continue;
    const delta = Date.parse(r.decided) - Date.parse(r.created);
    if (!Number.isFinite(delta)) continue;
    const list = decisionMsByChannel.get(r.channel);
    if (list) list.push(delta);
    else decisionMsByChannel.set(r.channel, [delta]);
  }
  const spendByChannel = listChannelSpend(workspaceId);
  const byChannel: ChannelEconomics[] = [...channelMap.entries()]
    .map(([channel, m]) => {
      const spendCzk = spendByChannel.get(channel) ?? null;
      return {
        channel,
        ...m,
        hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
        medianHoursToDecision: medianHours(decisionMsByChannel.get(channel) ?? []),
        spendCzk,
        // Cost figures only where the division is HONEST: spend entered, a non-zero
        // denominator (0 hires ⇒ no cost-per-hire, not infinity), AND an all-time
        // cohort. spend is a single LIFETIME figure per channel (listChannelSpend has
        // no window), so dividing it by a WINDOWED applicant/hire count mixed a
        // lifetime numerator with a short-window denominator — inflating CPA/CPH by
        // ~(lifetime / window), worst for the most mature accounts. In a windowed view
        // the ratio is null (UI renders "—") until spend is stored per-period.
        costPerApplicantCzk: !cutoffIso && spendCzk != null && m.total > 0 ? Math.round(spendCzk / m.total) : null,
        costPerHireCzk: !cutoffIso && spendCzk != null && m.hired > 0 ? Math.round(spendCzk / m.hired) : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  // E5 — creative-variant performance: entries carrying a source_variant,
  // grouped per (job × campaign × variant). firstLeadAt anchors the 72h
  // observation clock for the pause heuristic.
  const variantMap = new Map<string, VariantStat>();
  for (const r of rows) {
    if (!r.source_variant) continue;
    const key = `${r.job_id ?? ""}|${r.source_campaign ?? ""}|${r.source_variant}`;
    const v =
      variantMap.get(key) ??
      ({
        jobId: r.job_id,
        jobTitle: r.job_title,
        campaign: r.source_campaign,
        variant: r.source_variant,
        total: 0,
        reachedInterview: 0,
        hired: 0,
        firstLeadAt: null,
      } satisfies VariantStat);
    v.total += 1;
    if (idxOf(r.stage) >= idxOf("Interview")) v.reachedInterview += 1;
    if (r.stage === "Hired") v.hired += 1;
    if (r.created_at && (!v.firstLeadAt || r.created_at < v.firstLeadAt)) v.firstLeadAt = r.created_at;
    variantMap.set(key, v);
  }
  const variantStats = [...variantMap.values()].sort((a, b) => b.total - a.total);
  const BY_VARIANT_CAP = 24;
  const byVariant = variantStats.slice(0, BY_VARIANT_CAP);
  // Recommendations run over the FULL stat set, not the display cap — a starving
  // variant is precisely the one a top-N-by-volume cut would hide.
  const variantRecommendations = variantPauseRecommendations(variantStats, now);

  // UAT M7 — blended overall cost-per-hire for the leadership readout: total
  // recruiter-entered channel spend ÷ hires. Same honesty as the per-channel
  // figure — all-time only (spend is lifetime, not windowed) and only when there's
  // spend AND a hire to divide by; otherwise null ("—").
  const totalSpendCzk = [...spendByChannel.values()].reduce((sum, v) => sum + (v ?? 0), 0);
  const costPerHireCzk = !cutoffIso && totalSpendCzk > 0 && hired > 0 ? Math.round(totalSpendCzk / hired) : null;

  return {
    total,
    active,
    hired,
    rejected,
    declined,
    funnel,
    avgTimeToHireDays,
    avgAgeDays,
    bottleneck,
    stageDwell,
    byJob,
    byJobTotal,
    koDeclined,
    byArchetype,
    windowDays: windowDays ?? null,
    momentum,
    automation,
    bySource,
    byChannel,
    byVariant,
    byVariantTotal: variantStats.length,
    variantRecommendations,
    targets: analyticsTargets(workspaceId),
    costPerHireCzk,
    // b39992b1 — value of the automation over this window, at the stored (or
    // default) recruiter hourly rate, from the same kindCounts the rollup uses.
    // `hired` anchors the per-hire baseline framing (UAT M7).
    automationRoi: automationRoi(kindCounts, listAnalyticsTargets(workspaceId).get(RECRUITER_HOURLY_TARGET_KEY), hired),
  };
}

// 82c2b8e8 — recruiter-set analytics goals (small key/value table, mirroring the
// channel_spend persistence pattern). The time-to-hire goal lives under the
// reserved TIME_TO_HIRE_TARGET_KEY; every other row is a funnel stage name →
// conversion %% goal.

/** Set (positive value) or clear (null / non-positive) one analytics goal. P1 — the
 *  goal belongs to the caller's workspace (the PK is (metric, workspace_id)). */
export function setAnalyticsTarget(metric: string, value: number | null, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  const db = ensureDb();
  if (value == null || !(value > 0)) {
    db.prepare(`DELETE FROM analytics_targets WHERE metric = ? AND workspace_id = ?`).run(metric, workspaceId);
    return;
  }
  db.prepare(
    `INSERT INTO analytics_targets (metric, target_value, updated_at, workspace_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(metric, workspace_id) DO UPDATE SET target_value = excluded.target_value, updated_at = excluded.updated_at`
  ).run(metric, value, new Date().toISOString(), workspaceId);
}

/** All set goals as a metric → value map (stage names + the TTH key), for one workspace. */
export function listAnalyticsTargets(workspaceId: string = DEFAULT_WORKSPACE_ID): Map<string, number> {
  const rows = ensureDb()
    .prepare(`SELECT metric, target_value FROM analytics_targets WHERE workspace_id = ?`)
    .all(workspaceId) as {
    metric: string;
    target_value: number;
  }[];
  return new Map(rows.map((r) => [r.metric, r.target_value]));
}

/** Split the flat goal map into the funnel-conversion targets and the lone
 *  time-to-hire target the analytics payload exposes. */
function analyticsTargets(workspaceId: string = DEFAULT_WORKSPACE_ID): { conversion: Record<string, number>; timeToHireDays: number | null } {
  const all = listAnalyticsTargets(workspaceId);
  const timeToHireDays = all.get(TIME_TO_HIRE_TARGET_KEY) ?? null;
  const conversion: Record<string, number> = {};
  for (const [metric, value] of all) {
    // Only funnel-stage rows are conversion goals — exclude the reserved keys.
    if (metric !== TIME_TO_HIRE_TARGET_KEY && metric !== RECRUITER_HOURLY_TARGET_KEY) {
      conversion[metric] = value;
    }
  }
  return { conversion, timeToHireDays };
}

// ---- Cross-entity search (SHELL1, the command palette) ---------------------

export type SearchHit = {
  type: "profile" | "entry" | "job" | "jd" | "analysis";
  // The navigation handle the client maps to a deep link per type: profile id,
  // entry id (label drives the board filter), job id, JD slug, analysis slug.
  id: string;
  label: string;
  sub: string | null;
};

// Escape LIKE wildcards in user input so "100%" searches for the literal string;
// queries below pair the pattern with ESCAPE '\'.
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// One palette query across the five user-recallable entity tables. Plain LIKE
// over indexed-enough tables (all are small, capped per type) — newest rows
// first so the recently-touched record the recruiter is hunting for surfaces on
// top. Read-only; the route wraps it in safeJsonError.
export function searchEntities(query: string, limitPerType = 5, workspaceId: string = DEFAULT_WORKSPACE_ID): SearchHit[] {
  const db = ensureDb();
  const like = `%${escapeLike(query)}%`;
  const hits: SearchHit[] = [];

  const profiles = db
    .prepare(
      `SELECT id, label, archetype FROM profiles WHERE label LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, limitPerType) as { id: string; label: string; archetype: string | null }[];
  for (const p of profiles) hits.push({ type: "profile", id: p.id, label: p.label, sub: p.archetype });

  const entries = db
    .prepare(
      `SELECT id, candidate_label, job_title, stage FROM pipeline_entries
       WHERE (candidate_label LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\') AND workspace_id = ?
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, workspaceId, limitPerType) as { id: string; candidate_label: string; job_title: string | null; stage: string }[];
  for (const e of entries)
    hits.push({
      type: "entry",
      id: e.id,
      label: e.candidate_label,
      sub: [e.job_title, e.stage].filter(Boolean).join(" · ") || null,
    });

  const jobs = db
    .prepare(
      `SELECT id, title, company FROM jobs WHERE title LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { id: string; title: string; company: string | null }[];
  for (const j of jobs) hits.push({ type: "job", id: j.id, label: j.title, sub: j.company });

  const jds = db
    .prepare(
      `SELECT slug, title FROM jds
       WHERE (title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { slug: string; title: string }[];
  for (const d of jds) hits.push({ type: "jd", id: d.slug, label: d.title, sub: d.slug });

  const analyses = db
    .prepare(
      `SELECT slug, candidate_label, score FROM analyses
       WHERE candidate_label LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { slug: string; candidate_label: string | null; score: number | null }[];
  for (const a of analyses)
    hits.push({
      type: "analysis",
      id: a.slug,
      label: a.candidate_label || a.slug,
      sub: a.score != null ? String(a.score) : null,
    });

  return hits;
}
