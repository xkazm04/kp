import { pickBottleneck, type Bottleneck } from "../analytics-bottleneck";
import { MOMENTUM_EVENT_KINDS, MOMENTUM_WEEKS, weeklyMomentum, type MomentumWeek } from "../analytics-momentum";
import { summarizeAutomationImpact, type AutomationImpact } from "../decision-attribution";
import { offerConversion, type OfferConversion } from "../analytics-offer";
import { automationRoi, type AutomationRoi } from "../automation-roi";
import { hasAdvancedPastScreening, screeningGateIndex, stageHasRole, stageIndex, stagesWithRole, stageWithRole } from "../pipeline-stages";
import { getPipelineAxis } from "../pipeline-axis-server";
import { SIM_TITLE_LIKE } from "@/app/features/shell/simulation/constants";
import { ensureDb } from "./core";
import { JD_ACTIVE_SQL } from "./jobs";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { listChannelSpendDetail } from "./channels";

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
  variantRowKey,
  type VariantRecommendation,
  type VariantStat,
} from "../source-analytics";
import { median } from "../stats";

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
  /** THIS workspace's offer column, by role — the stage a "who is sitting on an offer"
   *  deep link must filter on. The offer panel used to spell it `"Offer"`, so on a board
   *  whose offer column is called "Package" the one link out of that panel filtered the
   *  board to a column that does not exist and landed the recruiter on an empty list.
   *  `null` when the axis declares no offer role (a legal two-column board) — the count
   *  is then rendered as plain text rather than a link that cannot resolve. */
  offerStage: string | null;
  avgTimeToHireDays: number | null;
  // The MEDIAN of the same time-to-hire samples (avgTimeToHireDays is the mean). The
  // ROI ledger tile is labeled "median" and reads this, so an audit-grade leadership
  // readout states the statistic it claims (analytics-calibration-dashboards #1).
  medianTimeToHireDays: number | null;
  // HOW MANY hires the two statistics above were actually computed over — NOT `hired`.
  // The two populations are different and diverge silently: `hired` counts every entry
  // standing on a terminal stage, while the time-to-hire sample additionally needs BOTH
  // timestamps (created_at AND stage_changed_at) and a non-negative duration. An entry
  // seeded onto a terminal stage, or moved there by a path that deliberately leaves
  // stage_changed_at alone (see pipeline.ts — several transitions do exactly that so
  // time-in-stage stays honest), is a real hire the median cannot see. On the shipped
  // corpus that is 4 of the 9 terminal entries.
  //
  // Any consumer that publishes the median WITH A SAMPLE SIZE must quote this number,
  // never `hired`: the metric pack samples time_to_hire with `hired`, so a workspace
  // whose median rests on 5 observations can print "median 26 days over 9 hires",
  // clear the pack's MIN_SAMPLE floor on a sample that does not exist, and mark the
  // row `measured` / certifiable — in the one artifact meant to survive procurement.
  timeToHireSamples: number;
  // UAT M7 — blended overall cost per hire (Σ recruiter-entered channel spend ÷
  // hires), all-time only (windowed = null, mirroring the per-channel rule); the
  // single cost figure for the leadership readout.
  costPerHireCzk: number | null;
  // UAT KAT-ANA-2 — the age of the figure above: the OLDEST `channel_spend.updated_at`
  // among the rows summed into it. Oldest, not newest, because a blend is only as
  // current as its stalest input, and this number's whole failure mode is looking
  // current. Null whenever costPerHireCzk is null.
  costPerHireAsOf: string | null;
  // UAT KAT-ANA-4 — the hire count on the EVENT-TIME basis: entries whose TERMINAL
  // TRANSITION landed inside the window. `hired` above is a different population — the
  // creation COHORT (entries CREATED in the window that now stand on a terminal stage)
  // — and the two diverge by exactly the time-to-hire. Every per-hire figure computed
  // from event-time or ledger-time numerators (automationRoi, computeCost) divides by
  // THIS, so numerator and denominator describe the same window. Equal to `hired` in
  // the all-time view, where the two bases cannot differ.
  hiresClosedInWindow: number;
  // compute-cost-per-hire — the LLM compute that produced these hires, read from the
  // existing usage ledger (the llm_usage table insertLlmUsage writes). READ-ONLY: no
  // new metering, no writes. HONEST SCOPE LIMITS surfaced by the UI: (1) llm_usage has
  // NO workspace_id, so this is an ACCOUNT-WIDE total, not workspace-scoped; (2) the
  // ledger prices in USD (cost_usd), NOT the app currency (CZK), so the tile is
  // labelled in USD, never fake-converted; (3) `unpricedCalls` are NULL-cost rows
  // (Azure/unknown model) that sum to 0 — surfaced so "$0" ≠ "nothing spent".
  // costPerHireUsd divides the WINDOWED cost by the WINDOWED hire count. TENANT-SCOPE
  // CAVEAT: the numerator is ACCOUNT-WIDE (llm_usage has no workspace_id) while the
  // denominator is THIS workspace's hires — so the ratio is only an honest per-hire
  // figure in a single-workspace account. `workspaceCount` reports how many workspaces
  // share the workspace-blind ledger; when >1 the UI suppresses the per-hire figure
  // (it would inflate ~by the number of active workspaces). Null when there's no hire
  // to divide by. Null overall when the window holds no metered calls.
  //
  // KAT-ANA-7 — `windowDays` and `hires` make the basis SELF-DESCRIBING on screen: the
  // same ledger is read all-time here and 30-day in Billing, and neither surface used
  // to name its own period, so the two disagreed in public with no way to tell why.
  computeCost: {
    costUsd: number;
    calls: number;
    unpricedCalls: number;
    costPerHireUsd: number | null;
    workspaceCount: number;
    /** The period this cost covers, in days; null = all time. */
    windowDays: number | null;
    /** The hire count the per-hire figure divided by — `hiresClosedInWindow`, i.e.
     *  hires CLOSED in the same period, never the creation cohort. */
    hires: number;
  } | null;
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
  // Direction 1 — the offer leg (interview → offer → accepted): extended /
  // accepted / declined / expired rates folded from the SAME windowed kindCounts,
  // honesty-gated on the min-offers floor. Feeds the forecast's acceptance input.
  offers: OfferConversion;
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
  /** How many board entries in this window were LEFT OUT of every figure above
   *  because they are guided-demo residue (see `notSim`). Zero on a real install and
   *  after `resetSim`; non-zero only while a simulation run's rows are still on the
   *  board. The exclusion has always been correct — it was silent, so after a guided
   *  demo the funnel and the board disagreed with nothing on screen to say why. The
   *  page renders a footnote from this; it is a COUNT, never a set of rows. */
  excludedSim: number;
  /** TRUE when the cohort read hit {@link ANALYTICS_COHORT_CAP} and every figure
   *  below was therefore computed over the most recent `cap` entries rather than
   *  the whole matching set. A capped read that does not say so is the worse of
   *  the two bugs the cap fixes: an unbounded scan is slow, a silent slice is
   *  WRONG — the same `{ …, truncated }` contract `listJobsPage` states. */
  truncated: boolean;
  /** The IANA zone the DATE arithmetic on this payload was done in — always
   *  `"UTC"`, and stated rather than assumed. Every cutoff here is ISO-string
   *  comparison against `Date` millisecond arithmetic, and the weekly momentum
   *  buckets are cut the same way, so "the last 30 days" and every bucket edge
   *  are UTC midnights. A Prague operator's day starts one or two hours before
   *  that, which is enough to move a candidate created late in the evening into
   *  the neighbouring bucket — small, real, and invisible while nothing on the
   *  wire said which zone the page was counting in. Declared so a reader (and the
   *  header note beside the window switcher) can say so out loud; converting the
   *  arithmetic to the operator's zone is a separate, larger decision. */
  bucketTz: "UTC";
};

/** How many pipeline_entries rows one analytics aggregation will pull into memory.
 *
 *  Every figure on the Insights tab is computed in JS over rows this module SELECTs,
 *  and until this constant existed there was no ceiling on that read anywhere on the
 *  path: an all-time view is a full-table scan of the board, run twice per load
 *  (current window + the prior window the deltas diff against). The bound is high
 *  enough that no realistic deployment reaches it — 20k candidates in one cohort is
 *  a decade of hiring for the buyer this product is sized for — so in practice this
 *  buys a worst-case guarantee rather than changing any answer; when it IS reached,
 *  `truncated` says so instead of quietly reshaping the funnel. */
export const ANALYTICS_COHORT_CAP = 20_000;

/** The zone every date bound and bucket edge in this module is computed in — see
 *  `PipelineAnalytics.bucketTz`. A constant so the payload's claim and the
 *  arithmetic cannot drift apart. */
const BUCKET_TZ = "UTC" as const;

/** The four ORIGIN buckets `bySource` reports, from an entry's EARLIEST pipeline
 *  event kind. Declared once: this mapping was typed out byte-identically inside
 *  both `pipelineAnalytics` and `pipelineAnalyticsPrior`, whose whole contract is
 *  that they bucket the same rows the same way — two copies of the rule the delta
 *  depends on being identical is the one shape that rule must not have. */
function originOf(kind: string): string {
  if (kind === "applied") return "applied";
  if (kind === "matched") return "matched";
  if (kind === "added" || kind === "intake_degraded") return "added";
  return "other";
}

/** Resolve a caller's `rowCap` against the module cap. A non-positive or
 *  non-integer override would bind `LIMIT 0` (reads nothing) or `LIMIT -1`
 *  (SQLite's "unbounded", i.e. the very scan the cap exists to forbid), so both
 *  fall back to the constant rather than being trusted. */
function cohortCap(override?: number): number {
  return Number.isInteger(override) && (override as number) > 0
    ? Math.min(override as number, ANALYTICS_COHORT_CAP)
    : ANALYTICS_COHORT_CAP;
}

// 82c2b8e8 — the reserved analytics_targets row whose value is a time-to-hire
// goal in DAYS (every other row is a funnel stage name → conversion %% target).
export const TIME_TO_HIRE_TARGET_KEY = "time_to_hire";

// b39992b1 — the reserved analytics_targets row holding the org's recruiter hourly
// cost (CZK) for the automation ROI figure. Not a "goal" — but it rides the same
// key/value table + save route, so it lives alongside the goal keys and is
// filtered out of the conversion-goal map.
export const RECRUITER_HOURLY_TARGET_KEY = "recruiter_hourly_czk";

// UAT KAT-L1-005 — the reserved row holding the org's OWN manual hours-per-hire
// baseline. `MANUAL_HOURS_PER_HIRE = 42` is a defensible research mid-point, but it
// shipped as automationRoi's fourth parameter with no call site passing it, so the
// percentage the ROI panel prints ("x% of the manual effort offset") was measured
// against a constant no customer could contest. An org whose real anchor is 23 h
// screening + 13 h sourcing can now re-ground the claim in its own number.
export const MANUAL_HOURS_TARGET_KEY = "manual_hours_per_hire";

// Every analytics_targets key that is NOT a funnel-stage conversion goal. DERIVED,
// not hand-listed (drift-guard rule M3): the conversion-map filter below and the save
// route's validator both read this set, so adding a reserved key in one place cannot
// leave it leaking into the funnel goals in another.
export const RESERVED_TARGET_KEYS: ReadonlySet<string> = new Set([
  TIME_TO_HIRE_TARGET_KEY,
  RECRUITER_HOURLY_TARGET_KEY,
  MANUAL_HOURS_TARGET_KEY,
]);

export type ChannelEconomics = {
  channel: string;
  total: number;
  reachedInterview: number;
  hired: number;
  rejected: number;
  hireRatePct: number;
  medianHoursToDecision: number | null;
  spendCzk: number | null;
  // UAT KAT-ANA-2 — when a human last entered `spendCzk`. The three money columns on
  // this row are derived from that ONE stored number, so they carry its date: a
  // six-week-old entry must read as six weeks old, not as this period's cost.
  spendUpdatedAt: string | null;
  costPerApplicantCzk: number | null;
  costPerHireCzk: number | null;
};

// Rounded median of a numeric sample (empty → null). The median is the shared one
// (app/_lib/stats.ts — non-finite dropped, even counts averaged, empty ⇒ null), so
// the OrgBenchmarkPanel's "median time-to-hire" and every other median surface
// answer the same question the same way; only the whole-day rounding is local
// (this figure is read as days, and half a day is noise at this sample size).
function medianRounded(values: number[]): number | null {
  const m = median(values);
  return m === null ? null : Math.round(m);
}

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
  // `rowCap` overrides ANALYTICS_COHORT_CAP. Tests only — a production caller has
  // no business narrowing the cohort, and the flag it would set is the payload's
  // honesty about the DEFAULT bound.
  opts?: { endMs?: number; rowCap?: number },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): PipelineAnalytics {
  const db = ensureDb();
  const endMs = opts?.endMs ?? Date.now();
  const cutoffIso = windowDays ? new Date(endMs - windowDays * 86_400_000).toISOString() : null;
  const upperIso = opts?.endMs != null && windowDays ? new Date(endMs).toISOString() : null;
  const rowCap = cohortCap(opts?.rowCap);
  const ROW_COLUMNS =
    "job_id, job_title, archetype, stage, status, created_at, stage_changed_at, source_channel, source_campaign, source_variant";
  // NEWEST FIRST + one row past the cap: the ordering makes the slice deterministic
  // and meaningful when the cap bites (the most recent `cap` of the cohort, not an
  // arbitrary page), and the extra row is how `truncated` is known without a second
  // COUNT round-trip — the listJobsPage shape. SQLite sorts NULLs first, so DESC puts
  // created_at-less rows LAST, which is also where an all-time view wants them: they
  // carry no cohort date and are the first thing a bounded read should drop.
  const capped = <T>(list: T[]): { rows: T[]; truncated: boolean } =>
    list.length > rowCap ? { rows: list.slice(0, rowCap), truncated: true } : { rows: list, truncated: false };
  const read = capped(
    (cutoffIso
      ? upperIso
        ? db
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE created_at >= ? AND created_at < ? AND ${notSim()} AND workspace_id = ? ORDER BY created_at DESC LIMIT ?`
            )
            .all(cutoffIso, upperIso, SIM_TITLE_LIKE, workspaceId, rowCap + 1)
        : db
            .prepare(
              `SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE created_at >= ? AND ${notSim()} AND workspace_id = ? ORDER BY created_at DESC LIMIT ?`
            )
            .all(cutoffIso, SIM_TITLE_LIKE, workspaceId, rowCap + 1)
      : db
          .prepare(`SELECT ${ROW_COLUMNS} FROM pipeline_entries WHERE ${notSim()} AND workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
          .all(SIM_TITLE_LIKE, workspaceId, rowCap + 1)) as unknown[]
  );
  const truncated = read.truncated;
  const rows = read.rows as {
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

  // The size of the silence. `notSim()` drops guided-demo entries from every figure
  // on this page; counting what it dropped (over the SAME window and workspace, with
  // the predicate inverted) is what lets the page say so out loud instead of quietly
  // disagreeing with the board. NOT NULL-safe by accident: the inverse of
  // `(title IS NULL OR title NOT LIKE ?)` is `title IS NOT NULL AND title LIKE ?`,
  // so a title-less real entry is counted by neither side.
  const SIM_PREDICATE = "job_title IS NOT NULL AND job_title LIKE ?";
  const excludedSim = (
    cutoffIso
      ? upperIso
        ? db
            .prepare(
              `SELECT COUNT(*) AS n FROM pipeline_entries WHERE created_at >= ? AND created_at < ? AND ${SIM_PREDICATE} AND workspace_id = ?`
            )
            .get(cutoffIso, upperIso, SIM_TITLE_LIKE, workspaceId)
        : db
            .prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE created_at >= ? AND ${SIM_PREDICATE} AND workspace_id = ?`)
            .get(cutoffIso, SIM_TITLE_LIKE, workspaceId)
      : db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE ${SIM_PREDICATE} AND workspace_id = ?`).get(SIM_TITLE_LIKE, workspaceId)
  ) as { n: number };

  // Index against THIS WORKSPACE's axis, not the shipped list. A team that
  // renamed or added a column must get a funnel of ITS columns — indexing the
  // five canonical names produced a chart with rows nobody recognised, and
  // silently dropped (idxOf === -1) every candidate standing on a renamed one.
  const axis = getPipelineAxis(workspaceId).stages;
  const stageIds = axis.map((s) => s.id);
  const idxOf = (s: string) => stageIndex(s, axis);
  // "Reached the real-evaluation gate", by ROLE — the same threshold the
  // archetype-fairness metric uses, so the two can never report different numbers
  // for one cohort. And "finished", by role rather than by the name "Hired".
  const gateIdx = screeningGateIndex(axis);
  const isTerminal = (stage: string) => stageHasRole(stage, "terminal", axis);
  const now = Date.now();
  const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    // A blank/malformed timestamp parses to NaN; skip it rather than letting
    // NaN poison avgAgeDays / the bottleneck average downstream.
    return Number.isFinite(ms) ? Math.max(0, (now - ms) / 86_400_000) : null;
  };

  const total = rows.length;
  const hired = rows.filter((r) => isTerminal(r.stage)).length;
  // Now that declines carry their own status, `rejected` counts only company-side
  // passes; `declined` is the candidate-side close that used to be folded in.
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const declined = rows.filter((r) => r.status === "declined").length;
  const active = rows.filter((r) => r.status === "active" && !isTerminal(r.stage)).length;

  const reached = stageIds.map(() => 0);
  const current = stageIds.map(() => 0);
  for (const r of rows) {
    const i = idxOf(r.stage);
    if (i < 0) continue;
    for (let k = 0; k <= i; k += 1) reached[k] += 1;
    if (r.status === "active") current[i] += 1;
  }
  const funnel = stageIds.map((stage, i) => ({
    stage,
    reached: reached[i],
    current: current[i],
    conversionPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
  }));

  const tth = rows
    .filter((r) => isTerminal(r.stage) && r.created_at && r.stage_changed_at)
    .map((r) => (Date.parse(r.stage_changed_at as string) - Date.parse(r.created_at as string)) / 86_400_000)
    .filter((d) => d >= 0);
  const avgTimeToHireDays = tth.length ? Math.round(tth.reduce((a, b) => a + b, 0) / tth.length) : null;
  const medianTimeToHireDays = medianRounded(tth);

  const ages = rows
    .filter((r) => r.status === "active" && r.created_at)
    .map((r) => daysSince(r.created_at))
    .filter((d): d is number => d != null);
  const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;

  const perStageDays: Record<string, number[]> = {};
  for (const r of rows) {
    if (r.status !== "active" || isTerminal(r.stage)) continue;
    const d = daysSince(r.stage_changed_at ?? r.created_at);
    if (d != null) (perStageDays[r.stage] ??= []).push(d);
  }
  // Small-sample guard: a stage needs >= BOTTLENECK_MIN_SAMPLE active entries
  // before its average wait counts as a systemic bottleneck, so a lone stale
  // entry can't masquerade as a trend in the amber banner (idea-bdaf9b2c).
  const bottleneck = pickBottleneck(perStageDays);
  // Full per-stage dwell breakdown (the table beside the single-worst bottleneck
  // banner), ordered canonically and skipping stages with no active entries.
  const stageDwell = stageIds.flatMap((stage) => {
    const arr = perStageDays[stage];
    if (!arr || arr.length === 0) return [];
    return [{ stage, avgDays: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), count: arr.length }];
  });

  const jobMap = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of rows) {
    const key = r.job_title ?? "—";
    const m = jobMap.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= gateIdx) m.reachedInterview += 1;
    if (isTerminal(r.stage)) m.hired += 1;
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
    if (isTerminal(r.stage)) m.hired += 1;
    // "advanced past screening" = reached the gate or beyond (see
    // hasAdvancedPastScreening); a candidate AT Screened has not advanced past it.
    // THIS WORKSPACE's axis, like every other threshold on this page: called
    // without it the predicate fell back to the shipped five names, so on a board
    // with renamed columns every stage indexed to -1 and the equity headline
    // ("{pct}% advanced past screening") read a flat 0% for the whole cohort —
    // while byJob's reachedInterview, which the note above gateIdx claims is the
    // SAME threshold over the SAME rows, counted them correctly.
    if (hasAdvancedPastScreening(r.stage, axis)) m.advanced += 1;
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
  // `terminalStage` is what splits the `hired` series out of `advanced`, and it is a
  // REQUIRED argument (analytics-momentum.ts): left to a literal default, a workspace
  // whose final column is named anything else saw every completed hire land in the
  // `advanced` bars and a hire series flat at zero forever — the same rename failure
  // the funnel/terminal-role work closed everywhere else on this page. An axis with no
  // declared terminal role falls back to its OWN last column (the board's final one by
  // construction), never to the shipped name.
  const momentum = weeklyMomentum(
    momentumRows.map((r) => ({ kind: r.kind, toStage: r.to_stage, createdAt: r.created_at })),
    { weeks: momentumWeeks, terminalStage: stageWithRole("terminal", axis) ?? axis[axis.length - 1]?.id ?? "" }
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

  // Direction 1 — the offer leg, from the same windowed/sim-excluded/workspace-
  // scoped kindCounts (no new query). offer_sent = extended; the three terminal
  // kinds are the resolutions. Pure fold + honesty gate lives in analytics-offer.
  const offers = offerConversion({
    extended: kindCounts["offer_sent"] ?? 0,
    accepted: kindCounts["offer_accepted"] ?? 0,
    declined: kindCounts["offer_declined"] ?? 0,
    expired: kindCounts["offer_expired"] ?? 0,
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
  const sourceMap = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of sourceRows) {
    const key = originOf(r.kind);
    const m = sourceMap.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= gateIdx) m.reachedInterview += 1;
    if (isTerminal(r.stage)) m.hired += 1;
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
    if (idxOf(r.stage) >= gateIdx) m.reachedInterview += 1;
    if (isTerminal(r.stage)) m.hired += 1;
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
  const spendByChannel = listChannelSpendDetail(workspaceId);
  // UAT KAT-ANA-2 — a channel someone has RECORDED SPEND for gets a row even with no
  // attributed candidates, exactly as a role with KO discards and no entries does
  // above. Two reasons, and the second is the important one. (1) "We put 5,000 CZK
  // into LinkedIn and it produced nobody" is a finding, not an absence. (2) The spend
  // editor lives on these rows, so a channel with no row is a stored figure that STILL
  // divides into the blended cost-per-hire and STILL cannot be corrected — which is the
  // fossil defect surviving the fix that was supposed to close it. Every stored spend
  // row must be reachable from the surface that spends it.
  for (const channel of spendByChannel.keys()) {
    if (!channelMap.has(channel)) channelMap.set(channel, { total: 0, reachedInterview: 0, hired: 0, rejected: 0 });
  }
  const byChannel: ChannelEconomics[] = [...channelMap.entries()]
    .map(([channel, m]) => {
      const spend = spendByChannel.get(channel) ?? null;
      const spendCzk = spend?.amountCzk ?? null;
      return {
        channel,
        ...m,
        hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
        medianHoursToDecision: medianHours(decisionMsByChannel.get(channel) ?? []),
        spendCzk,
        // The date rides with the amount, always — the two cost columns below are
        // nothing but this one row divided by a count (UAT KAT-ANA-2).
        spendUpdatedAt: spend?.updatedAt ?? null,
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
    const key = variantRowKey(r.job_id, r.source_campaign, r.source_variant);
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
    if (idxOf(r.stage) >= gateIdx) v.reachedInterview += 1;
    if (isTerminal(r.stage)) v.hired += 1;
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
  const totalSpendCzk = [...spendByChannel.values()].reduce((sum, v) => sum + (v.amountCzk ?? 0), 0);
  const costPerHireCzk = !cutoffIso && totalSpendCzk > 0 && hired > 0 ? Math.round(totalSpendCzk / hired) : null;
  // UAT KAT-ANA-2 — and how old the oldest of those entries is. A blend is only as
  // current as its stalest input, so the OLDEST wins: quoting the newest would let one
  // fresh row launder a set of fossils.
  const spendDates = [...spendByChannel.values()].map((s) => s.updatedAt).filter(Boolean).sort();
  const costPerHireAsOf = costPerHireCzk != null && spendDates.length > 0 ? spendDates[0] : null;

  // UAT KAT-ANA-4 — the denominator every EVENT-TIME per-hire figure below divides by.
  //
  // `hired` is a CREATION COHORT count: entries CREATED inside the window that stand on
  // a terminal stage today. The automation-ROI numerator (kindCounts) and the compute
  // ledger are EVENT-TIME — work that HAPPENED inside the window. Dividing one by the
  // other compares two different populations, and they diverge by exactly the
  // time-to-hire: reproduced on a 44-day time-to-hire inside a 30-day window, 6 hires
  // closed while only 1 was in-cohort, so a full window of automated work was amortised
  // over a sixth of its hires — the ROI read 100% of the manual baseline against an
  // honest 31%, and compute read $62.40/hire against an honest $10.40. The comment that
  // used to sit here asserted the opposite ("both same-window → honest").
  //
  // Terminal transitions are matched by ROLE, never by the name "Hired" (G8): a team
  // that renames its final column still gets its hires counted.
  //
  // All-time needs no query at all — with no window every hire is both in cohort and in
  // the event trail, and `hired` additionally catches entries seeded straight onto a
  // terminal stage with no transition event to find.
  const terminalStageIds = stagesWithRole("terminal", axis);
  const hiresClosedInWindow = !cutoffIso
    ? hired
    : terminalStageIds.length === 0
      ? 0
      : Number(
          (
            db
              .prepare(
                `SELECT COUNT(DISTINCT entry_id) AS n FROM pipeline_events
                  WHERE kind IN ('advanced', 'auto_advanced')
                    AND to_stage IN (${terminalStageIds.map(() => "?").join(", ")})
                    AND entry_id IS NOT NULL
                    AND created_at >= ?${upperIso ? " AND created_at < ?" : ""}
                    AND ${notSim()} AND workspace_id = ?`
              )
              .get(...terminalStageIds, cutoffIso, ...(upperIso ? [upperIso] : []), SIM_TITLE_LIKE, workspaceId) as { n: number }
          ).n ?? 0
        );

  // compute-cost-per-hire — surface the (read-only) LLM usage ledger alongside the
  // recruiter-entered channel spend. The ledger is windowed by `ts`, so the per-hire
  // figure divides it by the hires CLOSED in that same window (hiresClosedInWindow),
  // not by the creation cohort. `windowDays` travels with the number so the panel can
  // print the period the cost covers (KAT-ANA-7: the same ledger is read all-time here
  // and 30-day in Billing). Null when the window holds no metered calls.
  const compute = computeCostWindow(windowDays, opts?.endMs);
  // Tenant-scope honesty: the compute numerator is account-wide (llm_usage is
  // workspace-blind) while the hire count is scoped to THIS workspace, so a per-hire
  // ratio is only honest in a single-workspace account. Count the workspaces sharing the
  // ledger (1 today) so the UI can suppress the figure when it would mix scopes.
  const workspaceCount = Number((db.prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number }).n) || 1;
  const computeCost =
    compute.calls > 0
      ? {
          ...compute,
          costPerHireUsd:
            hiresClosedInWindow > 0 ? Math.round((compute.costUsd / hiresClosedInWindow) * 100) / 100 : null,
          workspaceCount,
          windowDays: windowDays ?? null,
          hires: hiresClosedInWindow,
        }
      : null;

  // One read of the goal table for both consumers below (the conversion/TTH split and
  // the two reserved ROI parameters) instead of the two it used to do.
  const targetValues = listAnalyticsTargets(workspaceId);

  return {
    total,
    active,
    hired,
    rejected,
    declined,
    funnel,
    // By ROLE, never by the name "Offer" — same rule as `isTerminal` above.
    offerStage: stageWithRole("offer", axis),
    avgTimeToHireDays,
    medianTimeToHireDays,
    // The population the two statistics above actually cover — see the field note.
    // `hired` is a DIFFERENT (larger) count and must never be quoted as their sample.
    timeToHireSamples: tth.length,
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
    offers,
    bySource,
    byChannel,
    byVariant,
    byVariantTotal: variantStats.length,
    variantRecommendations,
    targets: analyticsTargets(targetValues),
    excludedSim: excludedSim.n,
    truncated,
    bucketTz: BUCKET_TZ,
    costPerHireCzk,
    costPerHireAsOf,
    hiresClosedInWindow,
    computeCost,
    // b39992b1 — value of the automation over this window, at the stored (or default)
    // recruiter hourly rate, from the same kindCounts the rollup uses.
    //
    // UAT KAT-ANA-4 — the per-hire anchor is hiresClosedInWindow, NOT `hired`: the
    // numerator is event-time, so the denominator must be too (see the note above it).
    // UAT KAT-L1-005 — and the manual baseline is the org's own when it has set one;
    // this was the parameter no call site passed, which pinned the "% of manual effort
    // offset" claim to a constant a customer could neither see nor contest.
    automationRoi: automationRoi(
      kindCounts,
      targetValues.get(RECRUITER_HOURLY_TARGET_KEY),
      hiresClosedInWindow,
      targetValues.get(MANUAL_HOURS_TARGET_KEY)
    ),
  };
}

// channel-story-complete — the period-over-period comparison (periodDeltas) reads
// ONLY these scalars off the prior window: total, hired, avgTimeToHireDays, the
// funnel conversion per stage, and per-source / per-channel volume + hire-rate (+ a
// per-channel CPA that is null in any windowed view). Everything else the full
// pipelineAnalytics battery computes for the prior window — momentum, automation,
// holds, the decision-time median, KO counts, spend, targets, variants — is thrown
// away by the route. Running that whole ~9-query battery twice per windowed load was
// pure waste; this computes the SAME compared scalars with just the two queries they
// need (the cohort SELECT + the first-event origin JOIN). Pinned byte-identical to
// the full battery's fields by analytics-prior-slice.test.ts.
export type PriorWindowSlice = {
  total: number;
  hired: number;
  avgTimeToHireDays: number | null;
  funnel: { stage: string; conversionPct: number | null }[];
  bySource: { source: string; total: number; hireRatePct: number }[];
  byChannel: { channel: string; total: number; hireRatePct: number; costPerApplicantCzk: number | null }[];
  /** Same bound, same honesty as PipelineAnalytics.truncated — a delta computed
   *  against a silently cut baseline is a wrong delta, not a small one. */
  truncated: boolean;
};

/**
 * The slim prior-window aggregation: exactly the fields periodDeltas() diffs, no
 * more. The route only ever calls this for the PRIOR window of a windowed load, so
 * `endMs` (the window's upper bound) and `windowDays` are always set — mirror the
 * full battery's prior call `pipelineAnalytics(windowDays, { endMs }, ws)`.
 *
 * Byte-identity notes (each choice matches the full battery's exact semantics):
 *  - The cohort SELECT is upper-AND-lower-bounded (`created_at >= cutoff AND < end`),
 *    exactly the full main query for a prior window (analytics.ts main SELECT).
 *  - bySource comes from the first-event origin JOIN with the LOWER bound ONLY — the
 *    full battery's sourceRows query applies `p.created_at >= cutoff` and no upper
 *    bound, so this replicates that (a bounded version would diverge from the value
 *    the route currently produces).
 *  - Per-channel CPA is null: spend is a lifetime total, so a windowed cohort has no
 *    honest per-period CPA (the full battery returns null in windowed views), which
 *    is why no channel_spend read is needed here at all.
 *  - ONE deliberate divergence (UAT KAT-ANA-2): the full battery now also emits a row
 *    for a channel that has recorded SPEND but no attributed candidates, so its stored
 *    figure stays editable. The prior slice does not, and must not — such a row is
 *    volume 0 with a null rate and a null CPA, i.e. it contributes nothing any delta
 *    could read, and adding it would reintroduce the channel_spend read this slice
 *    exists to avoid. periodDeltas already treats an absent prior channel as "no
 *    baseline", the same as an absent prior funnel stage.
 */
export function pipelineAnalyticsPrior(
  windowDays: number,
  endMs: number,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // Tests only — see pipelineAnalytics' note on the same option.
  opts?: { rowCap?: number }
): PriorWindowSlice {
  const db = ensureDb();
  const cutoffIso = new Date(endMs - windowDays * 86_400_000).toISOString();
  const upperIso = new Date(endMs).toISOString();
  const rowCap = cohortCap(opts?.rowCap);
  // Same axis resolution as pipelineAnalytics: the prior-window slice is diffed
  // against the live one, so the two MUST index identically or the delta would
  // compare a row of one funnel to a different row of another.
  const axis = getPipelineAxis(workspaceId).stages;
  const stageIds = axis.map((s) => s.id);
  const idxOf = (s: string) => stageIndex(s, axis);
  const isTerminal = (stage: string) => stageHasRole(stage, "terminal", axis);

  // Bounded + newest-first + one row past the cap, exactly like the full battery's
  // cohort read (see the note there) — the two must cut the SAME way or the delta
  // would compare a whole window against a slice of another.
  const capRead = db
    .prepare(
      `SELECT stage, status, created_at, stage_changed_at, source_channel
         FROM pipeline_entries
        WHERE created_at >= ? AND created_at < ? AND ${notSim()} AND workspace_id = ?
        ORDER BY created_at DESC LIMIT ?`
    )
    .all(cutoffIso, upperIso, SIM_TITLE_LIKE, workspaceId, rowCap + 1) as {
    stage: string;
    status: string;
    created_at: string | null;
    stage_changed_at: string | null;
    source_channel: string | null;
  }[];
  const truncated = capRead.length > rowCap;
  const rows = truncated ? capRead.slice(0, rowCap) : capRead;

  const total = rows.length;
  const hired = rows.filter((r) => isTerminal(r.stage)).length;

  const reached = stageIds.map(() => 0);
  for (const r of rows) {
    const i = idxOf(r.stage);
    if (i < 0) continue;
    for (let k = 0; k <= i; k += 1) reached[k] += 1;
  }
  const funnel = stageIds.map((stage, i) => ({
    stage,
    conversionPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
  }));

  const tth = rows
    .filter((r) => isTerminal(r.stage) && r.created_at && r.stage_changed_at)
    .map((r) => (Date.parse(r.stage_changed_at as string) - Date.parse(r.created_at as string)) / 86_400_000)
    .filter((d) => d >= 0);
  const avgTimeToHireDays = tth.length ? Math.round(tth.reduce((a, b) => a + b, 0) / tth.length) : null;

  // bySource — earliest-event origin, the SAME JOIN + lower-bound-only window the
  // full battery's sourceRows query uses (see byte-identity note above).
  const sourceRows = db
    .prepare(
      `SELECT p.stage AS stage, fe.kind AS kind
         FROM pipeline_entries p
         JOIN (SELECT entry_id, kind FROM pipeline_events
                WHERE id IN (SELECT MIN(id) FROM pipeline_events
                              WHERE entry_id IS NOT NULL AND ${notSim()} AND workspace_id = ? GROUP BY entry_id)
              ) fe ON fe.entry_id = p.id
        WHERE p.created_at >= ? AND ${notSim("p.job_title")} AND p.workspace_id = ?`
    )
    .all(SIM_TITLE_LIKE, workspaceId, cutoffIso, SIM_TITLE_LIKE, workspaceId) as { stage: string; kind: string }[];
  const sourceMap = new Map<string, { total: number; hired: number }>();
  for (const r of sourceRows) {
    const key = originOf(r.kind);
    const m = sourceMap.get(key) ?? { total: 0, hired: 0 };
    m.total += 1;
    if (isTerminal(r.stage)) m.hired += 1;
    sourceMap.set(key, m);
  }
  const bySource = [...sourceMap.entries()]
    .map(([source, m]) => ({ source, total: m.total, hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  // byChannel — the stored source_channel grouping off the same bounded cohort;
  // CPA is null in any windowed view (see byte-identity note above).
  const channelMap = new Map<string, { total: number; hired: number }>();
  for (const r of rows) {
    if (!r.source_channel) continue;
    const m = channelMap.get(r.source_channel) ?? { total: 0, hired: 0 };
    m.total += 1;
    if (isTerminal(r.stage)) m.hired += 1;
    channelMap.set(r.source_channel, m);
  }
  const byChannel = [...channelMap.entries()]
    .map(([channel, m]) => ({
      channel,
      total: m.total,
      hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
      costPerApplicantCzk: null,
    }))
    .sort((a, b) => b.total - a.total);

  return { total, hired, avgTimeToHireDays, funnel, bySource, byChannel, truncated };
}

// compute-cost-per-hire — read-only windowed aggregate of the LLM usage ledger (the
// llm_usage table insertLlmUsage writes; NOT a new meter and NOT a write). Scope
// caveats the callers/UI surface honestly: the table has NO workspace_id (so this is
// an ACCOUNT-WIDE total), and cost_usd is priced in USD, not the app currency. Sums
// cost over PRICED rows only; `unpricedCalls` counts the NULL-cost rows (Azure /
// unknown model) that would otherwise sum to a misleading $0. Windowed by `ts` (which
// is indexed) to match the cohort window; `endMs` upper-bounds it for parity with a
// prior-window cohort. A null/absent window sums all time.
export function computeCostWindow(
  windowDays?: number | null,
  endMs?: number
): { costUsd: number; calls: number; unpricedCalls: number } {
  const db = ensureDb();
  const end = endMs ?? Date.now();
  const cutoffIso = windowDays ? new Date(end - windowDays * 86_400_000).toISOString() : null;
  const upperIso = endMs != null && windowDays ? new Date(end).toISOString() : null;
  const clauses: string[] = [];
  const args: string[] = [];
  if (cutoffIso) {
    clauses.push("ts >= ?");
    args.push(cutoffIso);
  }
  if (upperIso) {
    clauses.push("ts < ?");
    args.push(upperIso);
  }
  // tiger X2: a FAILED attempt (outcome 'failed') is now a row in this table, and
  // cost-per-hire must not learn about it here. It has NULL tokens and NULL cost
  // because the provider reported none, so counting it would inflate `calls`, and
  // counting it as `unpriced` would confuse "we cannot price this call" with "the
  // call died" — two facts an operator acts on differently. Named in the WHERE, not
  // conditioned per-aggregate as in aggregateLlmUsage: this function returns one
  // number about spend, with nowhere to put a failure count that would mean
  // anything. Pre-migration rows are all 'ok' (NOT NULL DEFAULT), so a populated DB
  // returns exactly what it returned before.
  clauses.push("outcome = 'ok'");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM llm_usage ${where}`
    )
    .get(...args) as { calls: number; cost_usd: number; unpriced: number | null };
  return {
    // Cents precision — the ledger prices sub-dollar per call; integer rounding would
    // collapse a real spend to "$0".
    costUsd: Math.round((row.cost_usd ?? 0) * 100) / 100,
    calls: Number(row.calls ?? 0),
    unpricedCalls: Number(row.unpriced ?? 0),
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
 *  time-to-hire target the analytics payload exposes. Takes the already-read map so
 *  one request reads analytics_targets once. */
function analyticsTargets(all: Map<string, number>): { conversion: Record<string, number>; timeToHireDays: number | null } {
  const timeToHireDays = all.get(TIME_TO_HIRE_TARGET_KEY) ?? null;
  const conversion: Record<string, number> = {};
  for (const [metric, value] of all) {
    // Only funnel-stage rows are conversion goals. The exclusion reads the DERIVED
    // reserved-key set rather than a hand-written chain of !== comparisons: the
    // manual-hours key was the third reserved row, and a chain like that is exactly
    // what leaks the fourth one into the funnel goals as a phantom stage (rule M3).
    if (!RESERVED_TARGET_KEYS.has(metric)) conversion[metric] = value;
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
//
// EVERY sub-query below filters on the tenant. That is worth stating because it
// was true of only ONE of the five: `workspaceId` was threaded in from the route
// and then bound for `pipeline_entries` alone, so the command palette answered
// two typed letters with another team's candidate profiles, analysis scores, job
// openings and JD drafts — each hit deep-linking straight to the record. The
// predicates are not uniform, and copying the wrong one silently re-opens it:
//   profiles / jds / analyses  strict `workspace_id = ?` (team-private)
//   jobs                       `(workspace_id IS NULL OR = ?)` — NULL rows are the
//                              shared cross-company reference corpus every team
//                              matches against, so they MUST stay visible
// Each matches the canonical list read for that table (db/profiles.ts:89,
// db/jobs.ts:157 and :361, db/analyses.ts:115).
export function searchEntities(query: string, limitPerType = 5, workspaceId: string = DEFAULT_WORKSPACE_ID): SearchHit[] {
  const db = ensureDb();
  const like = `%${escapeLike(query)}%`;
  const hits: SearchHit[] = [];

  const profiles = db
    .prepare(
      `SELECT id, label, archetype FROM profiles WHERE label LIKE ? ESCAPE '\\' AND workspace_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, workspaceId, limitPerType) as { id: string; label: string; archetype: string | null }[];
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

  // Dual-tier: NULL workspace_id is the shared corpus, so it stays searchable.
  const jobs = db
    .prepare(
      `SELECT id, title, company FROM jobs
       WHERE (title LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\')
         AND (workspace_id IS NULL OR workspace_id = ?)
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, workspaceId, limitPerType) as { id: string; title: string; company: string | null }[];
  for (const j of jobs) hits.push({ type: "job", id: j.id, label: j.title, sub: j.company });

  const jds = db
    .prepare(
      `SELECT slug, title FROM jds
       WHERE (title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') AND ${JD_ACTIVE_SQL} AND workspace_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, workspaceId, limitPerType) as { slug: string; title: string }[];
  for (const d of jds) hits.push({ type: "jd", id: d.slug, label: d.title, sub: d.slug });

  const analyses = db
    .prepare(
      `SELECT slug, candidate_label, score FROM analyses
       WHERE (candidate_label LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') AND workspace_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, workspaceId, limitPerType) as { slug: string; candidate_label: string | null; score: number | null }[];
  for (const a of analyses)
    hits.push({
      type: "analysis",
      id: a.slug,
      label: a.candidate_label || a.slug,
      sub: a.score != null ? String(a.score) : null,
    });

  return hits;
}
