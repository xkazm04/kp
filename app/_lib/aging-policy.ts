// THE aging clock (challenge-r02 pipeline-actions-events/A). One answer to "has this
// candidate waited too long in this stage", read by every surface that asks it:
//
//   - the board's amber dot + aging stat (pipelineRenderDiet.ts `agingBucket`),
//   - the sidebar Pipeline badge (attention.ts `attentionStale`),
//   - the automation policy pass, which is HANDED the tier per entry
//     (db/pipeline.ts `listActiveEntriesForAutomation` stamps `agingTier`) and maps it
//     to its feed alert kinds in pipeline/jobfit/automation.py.
//
// Before this module the three disagreed: the board and badge aged a card on its stage
// ROLE's SLA (offer 3 d, interview 5 d, terminal never), while the pass wrote alerts on
// one flat 21/30-day cut for every stage, a hire included — so an offer went amber on
// day 3 and the feed said nothing until day 21, and a hire collected an aging_alert
// every day from day 30 on. The registry's recruiting/pipeline-aging-and-attention-
// triage techniques (per-stage thresholds, terminal stages never age, aging-versus-
// stalled two-tier alerts) are what this encodes.
//
// The Python side never re-derives the tier: it receives the string. What crosses the
// boundary as CODE (the vocabulary, the tier -> alert-kind map, the shipped terminal
// name its fallback guards) is bound by pipeline/jobfit/tests/test_automation.py
// `AgingTierSyncTest`, which reads the literals below — the test_fit_threshold_sync.py
// shape. Keep AGING_TIERS and AGING_TIER_ALERT literal for that reason.
//
// Deliberately free of the DB and of React: the board imports it in the browser, and
// db/pipeline.ts imports it on every route that touches the store — keep it a leaf.
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, roleOf, STAGE_ROLE, stageHasRole, type StageDef, type StageRole } from "./pipeline-stages";

// ---- The SLA table (moved here from app/features/shared/pipelineTypes.ts, which
// re-exports it, so the server-side store can read it without the client module). ----

export const STALE_DAYS = 10; // legacy flat default — fallback for unknown stages

// Per-ROLE aging SLAs in days (PIPE4). A candidate sitting 10 days at an offer is
// a stall worth chasing; 10 days freshly arrived is normal. Stage-appropriate
// thresholds flag the right cards instead of one blunt global cut. Keyed by what a
// column MEANS, not what it is called: the axis is workspace-editable (Settings →
// Hiring), and a threshold keyed to the name "Interview" stops firing the moment a
// team renames the column to "First round" and adds a "Tech round" beside it — the
// badge goes quiet with nothing on screen admitting it. `scoring` waits like an
// interview (a candidate genuinely sits there until a human ratifies the number);
// `terminal` never ages; `custom` maps to no product semantics, so it gets the
// flat legacy cut. Recruiters can override these per board (localStorage, keyed by
// column id), so these are defaults, not hard limits.
export const ROLE_SLA_DEFAULTS: Record<StageRole, number> = {
  entry: 14,
  screening: 7,
  // A case takes real evenings to do. Chasing at day 5 reads as pressure on unpaid
  // work; a week is the point at which silence is genuinely worth a nudge.
  homework: 7,
  interview: 5,
  scoring: 5,
  offer: 3,
  terminal: 0,
  custom: STALE_DAYS,
};

/** The shipped five, by name — DERIVED from the role table so the two can never
 *  disagree. Kept for callers that only know a canonical name (and as the fallback
 *  for a retired id that is no longer on any axis but still has rows standing on
 *  it: a candidate stranded on the old "Offer" column still ages like an offer). */
export const STAGE_SLA_DEFAULTS: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((id) => [id, ROLE_SLA_DEFAULTS[STAGE_ROLE[id]]])
);

/** Days a candidate may sit in `stage` before the board flags it as aging, given
 *  optional per-board overrides and the axis the board is rendering. Resolution
 *  order: the recruiter's override for this column id → the default for the ROLE
 *  the column plays on `axis` → the shipped default for a canonical name that is
 *  off the axis (retired) → the flat STALE_DAYS for a stage nothing knows. A
 *  non-positive value (terminal = 0) means the stage never ages — callers already
 *  exclude terminal roles, but this keeps it explicit. Byte-identical to the old
 *  name-keyed table on the shipped axis. */
export function slaForStage(
  stage: string,
  overrides?: Record<string, number> | null,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): number {
  const o = overrides?.[stage];
  if (typeof o === "number" && o > 0) return o;
  const role = roleOf(stage, axis);
  if (role) return ROLE_SLA_DEFAULTS[role];
  const d = STAGE_SLA_DEFAULTS[stage];
  return typeof d === "number" ? d : STALE_DAYS;
}

// ---- The tier ----

/** The tier vocabulary, least to most urgent. `aging` = past the stage SLA (the soft
 *  tier, the board's amber); `stalled` = past STALLED_MULTIPLE x the SLA (the hard tier). */
export const AGING_TIERS = ["none", "aging", "stalled"] as const;
export type AgingTier = (typeof AGING_TIERS)[number];

export function isAgingTier(value: unknown): value is AgingTier {
  return typeof value === "string" && (AGING_TIERS as readonly string[]).includes(value);
}

/** The stalled boundary, as ONE multiple of the stage SLA (stated once, here). */
export const STALLED_MULTIPLE = 2;

/** Which persisted pipeline_events kind each alerting tier is written as. The kind
 *  names predate this module and are kept so every stored row still reads; note they
 *  are the "wrong way round" by name — the soft tier is `stale_alert`, the hard tier is
 *  `aging_alert` — which is exactly why the mapping is written down once instead of
 *  being re-guessed at each end. */
export const AGING_TIER_ALERT = { aging: "stale_alert", stalled: "aging_alert" } as const;
export type AgingAlertKind = (typeof AGING_TIER_ALERT)[keyof typeof AGING_TIER_ALERT];

const AGING_ALERT_KINDS: ReadonlySet<string> = new Set(Object.values(AGING_TIER_ALERT));
/** Is `kind` one of the two aging alert kinds (deduped once per stage stint)? */
export function isAgingAlertKind(kind: string): kind is AgingAlertKind {
  return AGING_ALERT_KINDS.has(kind);
}

const DAY_MS = 86_400_000;

/** The aging tier of a candidate `daysInStage` days into `stage`.
 *
 *  - A stage playing the terminal ROLE on `axis` never ages (a hire is not "waiting").
 *  - A non-positive SLA means never-ages (slaForStage's contract), so a retired
 *    terminal id still standing on a migrated board reads `none`, not instantly stale.
 *  - An unknown dwell (null / non-finite) reads fresh.
 *
 *  `overrides` are the board's per-column SLA overrides (a browser concern); server
 *  callers pass none and get the role defaults. */
export function agingTier(
  stage: string,
  daysInStage: number | null | undefined,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS,
  overrides?: Record<string, number> | null
): AgingTier {
  if (stageHasRole(stage, "terminal", axis)) return "none";
  if (typeof daysInStage !== "number" || !Number.isFinite(daysInStage)) return "none";
  const sla = slaForStage(stage, overrides, axis);
  if (!(sla > 0)) return "none";
  if (daysInStage >= sla * STALLED_MULTIPLE) return "stalled";
  if (daysInStage >= sla) return "aging";
  return "none";
}

/** Whole days between an ISO instant and `now`, or null when unparseable/absent. */
export function daysInStageAt(stageChangedAt: string | null | undefined, now: number): number | null {
  if (!stageChangedAt) return null;
  const t = Date.parse(stageChangedAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

/** agingTier over a stage-entry timestamp — the form the board and the badge hold. */
export function agingTierAt(
  stage: string,
  stageChangedAt: string | null | undefined,
  now: number,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS,
  overrides?: Record<string, number> | null
): AgingTier {
  return agingTier(stage, daysInStageAt(stageChangedAt, now), axis, overrides);
}
