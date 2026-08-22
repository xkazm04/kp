// Pure, dependency-free schema + policy for the Phase 3 decision rules. Kept in
// its own module (no `better-sqlite3`, no `@/`-aliased imports) so the validator
// and the small-cohort rounding policy can be exercised directly by Node's
// built-in test runner — see decision-config-schema.test.ts — AND imported into
// the client `DecisionRulesModal` without dragging the DB into the browser
// bundle. The persistence layer (decision-config-store.ts) and the route
// boundary (api/decisions/config) both validate writes through here, and
// screen-wave.ts reads the rounding policy from here, so the contract has ONE
// source of truth.

import { DEFAULT_REGIME_ID, REGIME_IDS, type RegimeId } from "./compliance-regimes.ts";
import { ROLE_FAMILY_SLUGS } from "./role-families.ts";
// pipeline-stages.ts is equally dependency-free (no DB, no alias), so importing
// the shipped axis here keeps this module loadable by `node --test` and the
// browser alike — and makes the board the literal source of the axis default.
import { DEFAULT_STAGE_AXIS, roleOf, stagesWithRole, stageWithRole, type StageDef, type StageRole } from "./pipeline-stages.ts";

// Screening auto-reject: drop the bottom `rejectBottomPercent` of a role's
// matched candidates that are ALSO below `maxMatchToReject` match — never
// early-career. Off by default (opt-in), like the automation clock.
//
// PER-FAMILY FLOORS (family-floors): per-family reliability is measured and a
// per-family recommendation is computable, but the screening floor used to be a
// single GLOBAL knob — so the per-family view could only inform, never act.
// `familyFloors` is an OPTIONAL map role_family → maxMatchToReject override, each
// bounded by the exact same 0–100 validation as the global value. ABSENT (the
// default) means the global floor applies to every family, so the shipped default
// is byte-identical to before this field existed (see effectiveFloor).
export type ScreeningRule = {
  autoRejectEnabled: boolean;
  rejectBottomPercent: number; // 0–100
  maxMatchToReject: number; // 0–100 match score
  familyFloors?: Record<string, number>; // role_family → maxMatchToReject override (0–100)
  /** CALIBRATION HOLDOUT — the percentage of would-be auto-rejects that are spared
   *  and allowed to proceed, so their outcomes are uncontaminated by the score that
   *  would have rejected them (UAT 2026-07-20, KAT-L1-001/002).
   *
   *  Why this exists: calibration pairs the match score against an outcome label
   *  where `rejected` counts as a negative — but the screening wave PRODUCES that
   *  rejection by testing the score against a floor. The predictor causes its own
   *  label, so a perfectly biased screener that favoured polished CVs would still
   *  draw a near-perfect reliability curve. Every accuracy claim is unfalsifiable
   *  until some below-floor candidates are observed WITHOUT the score acting on them.
   *
   *  This is the clean arm. 0 disables it (calibration then stays circular). */
  holdoutPercent?: number; // 0–100
};

/** The auto-reject floor that actually applies to a candidate: the family override
 *  when this role family carries one, else the global `maxMatchToReject`. A null /
 *  unknown family, or a family with no override, always resolves to the global value,
 *  so the pre-family-floors behavior is preserved byte-for-byte. Pure + total. */
export function effectiveFloor(cfg: ScreeningRule, roleFamily: string | null | undefined): number {
  const override = roleFamily && cfg.familyFloors ? cfg.familyFloors[roleFamily] : undefined;
  return typeof override === "number" && Number.isFinite(override) ? override : cfg.maxMatchToReject;
}

export const SCREENING_DEFAULT: ScreeningRule = {
  autoRejectEnabled: false,
  rejectBottomPercent: 20,
  maxMatchToReject: 45,
};

/** Share of would-be auto-rejects spared as the calibration clean arm when a rule
 *  doesn't state one. Deliberately NOT a key in SCREENING_DEFAULT: the persisted
 *  rule shape is pinned "byte-identical, no phantom key" by the config tests, and a
 *  saved rule from before the holdout existed must keep validating unchanged.
 *  Resolved at point of use via `effectiveHoldoutPercent` instead. */
export const DEFAULT_HOLDOUT_PERCENT = 5;

/** The holdout rate actually in force. An absent value takes the default (an old
 *  saved rule still gets a clean arm); an explicit 0 disables it, which is how a
 *  workspace opts out. Non-finite / negative fails closed to 0 — a malformed config
 *  must never spare an unbounded share of a wave. */
export function effectiveHoldoutPercent(cfg: ScreeningRule): number {
  const raw = cfg.holdoutPercent;
  if (raw === undefined || raw === null) return DEFAULT_HOLDOUT_PERCENT;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(100, raw);
}

// P1-1 — the active compliance JURISDICTION (workspace setting). Drives the
// candidate AI-disclosure framing + the recruiter compliance posture. Defaults to
// "eu", which reproduces the app's pre-P1-1 GDPR framing exactly.
export type ComplianceRule = {
  jurisdiction: RegimeId;
};

export const COMPLIANCE_DEFAULT: ComplianceRule = {
  jurisdiction: DEFAULT_REGIME_ID,
};

// The hiring-pipeline plan (Settings → Hiring): which interview rounds run and
// where a human approves. Persisted per workspace through the same tiered
// decision-config store; consumed (eventually) by the pipeline action layer —
// see docs/concepts/interview-rounds.md. The stored shape carries NO round ids
// (those are UI list keys, minted on load by the composer model).
// STAGE-KEYED (v2). The plan used to be three loose fields — `screeningGate`, a
// flat `rounds` array, `offerGate` — which said nothing about WHICH board column
// each governed. Two defects followed, and both are why the steps editor and the
// policy matrix had to stay two separate tables:
//
//   1. Rounds bound to interview columns left-to-right and any SURPLUS stacked
//      implicitly on the last one (the shipped default does exactly this: two
//      rounds, one `Interview` column). That binding lived in a derivation, not
//      in the data, so nothing could state it and nothing could edit it.
//   2. The gates were keyed by ROLE, not by column — one `screeningGate` for the
//      whole workspace. But `pipelineAxisDraft` only requires entry, terminal and
//      offer to be UNIQUE: screening and interview columns may repeat. A second
//      screening column shared the first one's gate, so a per-column control
//      would have been writing a shared value while appearing to write its own.
//
// Now every policy names its `stageId` and an interview column carries its own
// rounds. A column the plan says nothing about (entry, terminal, or one just
// added) simply has no step — absence is the default, never a fabricated gate.
export type InterviewPlanGate = "auto" | "human";
export type InterviewPlanRoundKind = "ai" | "human";
export type InterviewPlanRound = {
  kind: InterviewPlanRoundKind;
  /** Who ratifies the round's verdict. A HUMAN round is always human-gated by
   *  definition — the validator normalizes it so a stored plan can't claim an
   *  unattended human interview. */
  gate: InterviewPlanGate;
  /** Cohort reducer INTO this round (top N of the previous round's advancers);
   *  null = everyone. Always null on the plan's first round. */
  topN: number | null;
};
/** One board column's policy. */
export type InterviewPlanStep = {
  /** A stage id from this workspace's `pipelineStages` axis — the same id the
   *  board draws as a column and `pipeline_entries.stage` stores. */
  stageId: string;
  /** Who ratifies what happens at this column. */
  gate: InterviewPlanGate;
  /** The rounds that run HERE, in order. Empty on non-interview columns. One
   *  round is the 1:1 shape the merged editor draws as a single row; more than
   *  one is legal and lossless — that is what the old flat array's implicit
   *  stacking actually meant, now said out loud. */
  rounds: InterviewPlanRound[];
};
export type InterviewPlanRule = {
  /** Per-column policy, in board order. Columns absent from this list have no
   *  policy — never a defaulted one. */
  steps: InterviewPlanStep[];
};

export const INTERVIEW_PLAN_MAX_ROUNDS = 3;
/** Columns a plan may govern. Entry and terminal are arrival and outcome, not
 *  decisions, so a step naming one is dropped rather than silently kept. */
const PLANNABLE_ROLES: readonly StageRole[] = ["screening", "interview", "scoring", "offer", "custom"];

/** This column's policy, or null when the plan says nothing about it. Null is a
 *  real answer — a column added after the plan was saved has no gate, and
 *  inventing one would claim an approval rule nobody chose. */
export function planStep(plan: InterviewPlanRule, stageId: string): InterviewPlanStep | null {
  return plan.steps.find((s) => s.stageId === stageId) ?? null;
}

/** Every round the plan runs, flattened in board order. The old flat `rounds`
 *  array read this way by construction; the sequencing rules below still think
 *  in it, so it stays available as a derivation rather than as storage. */
export function planRounds(plan: InterviewPlanRule): InterviewPlanRound[] {
  return plan.steps.flatMap((s) => s.rounds);
}

/** Does the plan run at least one round of this kind? Drives which Schedule
 *  surfaces (AI docket / human calendar) are live for the workspace. Pure —
 *  shared by the client tab and the server routing. */
export function planHasRound(plan: InterviewPlanRule, kind: InterviewPlanRoundKind): boolean {
  return plan.steps.some((s) => s.rounds.some((r) => r.kind === kind));
}

/** The hybrid handoff rule: after an AI round's scorecard is ACCEPTED, does a
 *  HUMAN round still follow in the plan? True → the accept routes the candidate
 *  back to the calendar gate (human-round scheduling) instead of advancing
 *  toward Offer. Anchored on the FIRST ai round — the product runs one AI round
 *  today; a second AI round would need a per-entry round pointer to sequence.
 *
 *  Reads the flattened sequence, so it is indifferent to whether the human round
 *  sits at the same column as the AI one (the legacy stacked shape) or at its
 *  own column (what the stage-keyed model lets a workspace express). */
export function planRoutesAiScorecardToHumanRound(plan: InterviewPlanRule): boolean {
  const rounds = planRounds(plan);
  const aiIdx = rounds.findIndex((r) => r.kind === "ai");
  if (aiIdx === -1) return false;
  return rounds.slice(aiIdx + 1).some((r) => r.kind === "human");
}

/** Drop steps this axis has no column for, or whose column cannot hold policy
 *  (entry/terminal). Applied at READ time: an axis edit that removes a column
 *  must not leave the plan governing a column that is gone, and the plan is not
 *  rewritten on disk for it — the next save persists the pruned shape. */
export function prunePlanToAxis(plan: InterviewPlanRule, axis: readonly StageDef[]): InterviewPlanRule {
  const order = new Map(axis.map((s, i) => [s.id, i]));
  const steps = plan.steps
    .filter((step) => {
      if (!order.has(step.stageId)) return false;
      const role = roleOf(step.stageId, axis);
      return role != null && PLANNABLE_ROLES.includes(role);
    })
    // Board order, so `planRounds` sequences the way the candidate travels.
    .sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0));
  return steps.length === plan.steps.length && steps.every((s, i) => s === plan.steps[i]) ? plan : { steps };
}

/** The pre-stage-keyed wire shape, kept ONLY so stored blobs written before the
 *  migration can still be read. Never written. */
export type LegacyInterviewPlanRule = {
  screeningGate: InterviewPlanGate;
  rounds: InterviewPlanRound[];
  offerGate: InterviewPlanGate;
};

/**
 * Legacy plan → stage-keyed plan, against the axis that plan actually ran on.
 *
 * The conversion is the old runtime's own behavior, written down instead of
 * derived:
 *
 *  - `screeningGate` governed EVERY screening column (there was one gate and the
 *    axis may hold several), so each screening column gets it. Same for offer,
 *    which the axis model already forces to be unique.
 *  - rounds bound to interview columns left to right, and any surplus stacked on
 *    the LAST one — `deriveImpact` did exactly this, and the shipped default
 *    relies on it (two rounds, one `Interview` column). Reproduced here, so the
 *    migration cannot change what a workspace's hiring already does.
 *  - an interview column's gate is its first round's gate; a column that ends up
 *    with no rounds keeps "human", the conservative reading of an unstated gate.
 *  - rounds with nowhere to land (a plan with rounds on an axis with no
 *    interview column) are DROPPED, which is what the board already showed —
 *    there is no column to run them at.
 */
export function migrateLegacyInterviewPlan(
  legacy: LegacyInterviewPlanRule,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): InterviewPlanRule {
  const roundsByStage = new Map<string, InterviewPlanRound[]>();
  const interviewStages = stagesWithRole("interview", axis);
  legacy.rounds.forEach((round, i) => {
    const stageId = interviewStages[Math.min(i, interviewStages.length - 1)];
    if (!stageId) return;
    roundsByStage.set(stageId, [...(roundsByStage.get(stageId) ?? []), round]);
  });

  const offerStage = stageWithRole("offer", axis);
  const steps: InterviewPlanStep[] = [];
  for (const stage of axis) {
    if (stage.role === "screening") steps.push({ stageId: stage.id, gate: legacy.screeningGate, rounds: [] });
    else if (stage.role === "interview") {
      const rounds = roundsByStage.get(stage.id) ?? [];
      steps.push({ stageId: stage.id, gate: rounds[0]?.gate ?? "human", rounds });
    } else if (stage.id === offerStage) steps.push({ stageId: stage.id, gate: legacy.offerGate, rounds: [] });
  }
  return { steps };
}

/** Is this raw blob the pre-migration shape? Structural, not a version field:
 *  the store holds blobs written before any version existed. */
export function isLegacyInterviewPlan(raw: Record<string, unknown>): boolean {
  return raw.steps === undefined && (raw.screeningGate !== undefined || raw.offerGate !== undefined || Array.isArray(raw.rounds));
}

/**
 * Default: human-reviewed screening, ONE gated AI round at the board's single
 * `Interview` column, human-approved offers.
 *
 * It used to be two rounds (AI, then human for the top 3) STACKED behind that one
 * column, because nothing stopped it. One step now runs one activity — a second
 * conversation is a second column, which is a shape a candidate can actually be
 * standing on and a board can actually draw. The shipped board has one interview
 * column, so the shipped plan has one round.
 *
 * BEHAVIOUR CHANGE, and the only one in this pass: the hybrid handoff
 * (`planRoutesAiScorecardToHumanRound`) needs a human round AFTER an AI one, so it
 * no longer fires by default. A workspace that has ever saved its hiring plan is
 * untouched — the store returns what it saved, defaults apply only where nothing
 * was chosen — and a workspace that wants the handoff adds an Interview step and
 * sets its executor to a person, which is now a visible decision instead of an
 * invisible one.
 */
export const INTERVIEW_PLAN_DEFAULT: InterviewPlanRule = migrateLegacyInterviewPlan({
  screeningGate: "human",
  rounds: [{ kind: "ai", gate: "human", topN: null }],
  offerGate: "human",
});

// ---- pipelineStages: the board's own column axis, per workspace -------------
//
// The five board columns were a compile-time literal (PIPELINE_STAGES). This
// phase is how a workspace overrides them. Deliberately the SAME tiered
// decision-config store the interview plan uses rather than a new table: the
// tenancy manifest stays untouched, and the axis inherits the org-baseline /
// team-override tiering that hiring policy already has.
//
// `retired` is the half that makes an editable axis safe. A stage removed from
// the LIVE axis is moved here rather than deleted, so historical
// `pipeline_events` rows and analytics buckets referencing it still resolve to a
// label instead of rendering a raw id — and so a candidate found sitting on it
// can be named in the migration prompt. The board renders only `stages`.
export type PipelineStageRoleWire = "entry" | "screening" | "interview" | "scoring" | "offer" | "terminal" | "custom";
export type PipelineStageWire = { id: string; label: string; role: PipelineStageRoleWire };
export type PipelineStagesRule = {
  stages: PipelineStageWire[];
  retired: PipelineStageWire[];
};

/** Hard ceiling on board columns. The board scrolls horizontally at 280px per
 *  column, so this is a usability bound, not a storage one. */
export const PIPELINE_STAGES_MAX = 12;

/** The shipped axis, as a stored config. Built from DEFAULT_STAGE_AXIS so the
 *  board and the "no override yet" config can never be two different lists —
 *  the direction of truth the whole synchronization pass exists to establish. */
export const PIPELINE_STAGES_DEFAULT: PipelineStagesRule = {
  stages: DEFAULT_STAGE_AXIS.map((s) => ({ id: s.id, label: s.label, role: s.role as PipelineStageRoleWire })),
  retired: [],
};

const STAGE_ROLES: readonly PipelineStageRoleWire[] = ["entry", "screening", "interview", "scoring", "offer", "terminal", "custom"];
/** Roles that may appear AT MOST once: they answer "where does the funnel start /
 *  end / close", which cannot have two answers. `screening`, `interview` and
 *  `custom` repeat freely. */
const UNIQUE_ROLES: readonly PipelineStageRoleWire[] = ["entry", "terminal", "offer"];
/** Roles an axis MUST carry, because product rules resolve through them: a funnel
 *  needs somewhere to enter and somewhere to end. */
const REQUIRED_ROLES: readonly PipelineStageRoleWire[] = ["entry", "terminal"];

// The phases that have a known, validated config schema today. A write to any
// other phase is rejected at the boundary rather than persisted into a row that
// `getAllDecisionConfigs` would never read back anyway.
export const KNOWN_DECISION_PHASES = ["screening", "compliance", "interviewPlan", "pipelineStages"] as const;
export type DecisionPhase = (typeof KNOWN_DECISION_PHASES)[number];

const SCREENING_KEYS = ["autoRejectEnabled", "rejectBottomPercent", "maxMatchToReject", "familyFloors", "holdoutPercent"] as const;
const COMPLIANCE_KEYS = ["jurisdiction"] as const;
const INTERVIEW_PLAN_KEYS = ["steps"] as const;
const LEGACY_INTERVIEW_PLAN_KEYS = ["screeningGate", "rounds", "offerGate"] as const;
const INTERVIEW_PLAN_STEP_KEYS = ["stageId", "gate", "rounds"] as const;
const INTERVIEW_PLAN_ROUND_KEYS = ["kind", "gate", "topN"] as const;
const PIPELINE_STAGES_KEYS = ["stages", "retired"] as const;
const STAGE_KEYS = ["id", "label", "role"] as const;

export type DecisionConfigResult =
  | { ok: true; phase: "screening"; config: ScreeningRule }
  | { ok: true; phase: "compliance"; config: ComplianceRule }
  | { ok: true; phase: "interviewPlan"; config: InterviewPlanRule }
  | { ok: true; phase: "pipelineStages"; config: PipelineStagesRule }
  | { ok: false; error: string };

export type ScreeningOverrideResult =
  | { ok: true; override: Partial<ScreeningRule> }
  | { ok: false; error: string };

// Thrown by the persistence backstop (setDecisionConfig) when an unvalidated
// config reaches the write boundary. The route maps it to a 400; everywhere else
// it surfaces the contract violation loudly instead of silently persisting it.
export class DecisionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionConfigError";
  }
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Validate a decision-config write against its phase schema.
 *
 * Two distinct failure modes, deliberately handled differently:
 *   • MALFORMED (wrong type, stray key, missing field, NaN/Infinity, non-object,
 *     unknown phase) → rejected with a descriptive error. The caller turns this
 *     into a 400; nothing is persisted.
 *   • OUT-OF-RANGE but coercible numbers (e.g. 9999, -5) → CLAMPED to 0–100 and
 *     accepted. These mirror the modal's input clamps, which the API used to
 *     bypass entirely (idea-55baa5da).
 *
 * On success returns the clamped, fully-typed config — never the raw body — so
 * the persisted JSON can only ever contain the three known fields.
 */
export function validateDecisionConfig(phase: unknown, rawConfig: unknown): DecisionConfigResult {
  if (typeof phase !== "string" || !(KNOWN_DECISION_PHASES as readonly string[]).includes(phase)) {
    return {
      ok: false,
      error: `Unknown decision phase "${String(phase)}". Known phases: ${KNOWN_DECISION_PHASES.join(", ")}.`,
    };
  }
  if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
    return { ok: false, error: "config must be a plain object." };
  }
  // KNOWN_DECISION_PHASES gated entry above; dispatch to the per-phase validator.
  if (phase === "compliance") return validateComplianceRule(rawConfig as Record<string, unknown>);
  if (phase === "interviewPlan") return validateInterviewPlan(rawConfig as Record<string, unknown>);
  if (phase === "pipelineStages") return validatePipelineStages(rawConfig as Record<string, unknown>);
  return validateScreeningRule(rawConfig as Record<string, unknown>);
}

const isStageRole = (v: unknown): v is PipelineStageRoleWire =>
  typeof v === "string" && (STAGE_ROLES as readonly string[]).includes(v);

/** One stage entry: a stable id, a shown label, a role that carries the meaning. */
function validateStage(raw: unknown, path: string): { ok: true; stage: PipelineStageWire } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: `${path} must be an object.` };
  const rec = raw as Record<string, unknown>;
  const stray = Object.keys(rec).filter((k) => !(STAGE_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) return { ok: false, error: `${path}: unknown key(s) ${stray.join(", ")}.` };
  // The id is what lands in pipeline_entries.stage and both pipeline_events stage
  // columns, so it is bounded and shape-checked like any other wire identifier.
  // A label may be anything printable the recruiter types; it is never a key.
  if (typeof rec.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(rec.id)) {
    return { ok: false, error: `${path}.id must be 1-40 chars of letters, digits, space, hyphen or underscore.` };
  }
  if (typeof rec.label !== "string" || rec.label.trim() === "" || rec.label.length > 60) {
    return { ok: false, error: `${path}.label must be 1-60 characters.` };
  }
  if (!isStageRole(rec.role)) return { ok: false, error: `${path}.role must be one of: ${STAGE_ROLES.join(", ")}.` };
  return { ok: true, stage: { id: rec.id, label: rec.label.trim(), role: rec.role } };
}

function validateStageList(
  raw: unknown,
  path: string,
  max: number
): { ok: true; stages: PipelineStageWire[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${path} must be an array.` };
  if (raw.length > max) return { ok: false, error: `${path} is capped at ${max} entries.` };
  const stages: PipelineStageWire[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    const result = validateStage(entry, `${path}[${i}]`);
    if (!result.ok) return result;
    // Duplicate ids would make `pipeline_entries.stage` ambiguous — two columns
    // would claim the same candidates, and a migration could not name a target.
    if (seen.has(result.stage.id)) return { ok: false, error: `${path}: duplicate stage id "${result.stage.id}".` };
    seen.add(result.stage.id);
    stages.push(result.stage);
  }
  return { ok: true, stages };
}

/**
 * Validate a workspace's board axis.
 *
 * Beyond shape, this enforces the two invariants the rest of the product resolves
 * through — an axis needs somewhere to ENTER and somewhere to END, and the roles
 * that answer a "where" question may not have two answers. Everything else is
 * open: any number of screening stages, interview rounds or custom columns, in
 * any order, under any name.
 *
 * A live stage and a retired one may not share an id: `pipeline_entries.stage`
 * would then resolve to two different columns depending on which list was
 * consulted.
 */
function validatePipelineStages(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(PIPELINE_STAGES_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) return { ok: false, error: `pipelineStages: unknown key(s) ${stray.join(", ")}.` };

  const live = validateStageList(raw.stages, "pipelineStages.stages", PIPELINE_STAGES_MAX);
  if (!live.ok) return live;
  if (live.stages.length < 2) return { ok: false, error: "pipelineStages.stages needs at least an entry and a terminal stage." };

  for (const role of REQUIRED_ROLES) {
    if (!live.stages.some((s) => s.role === role)) {
      return { ok: false, error: `pipelineStages.stages must contain exactly one "${role}" stage.` };
    }
  }
  for (const role of UNIQUE_ROLES) {
    const count = live.stages.filter((s) => s.role === role).length;
    if (count > 1) return { ok: false, error: `pipelineStages.stages may contain at most one "${role}" stage (found ${count}).` };
  }
  // Ordering invariant: the funnel runs one way. An entry stage after the
  // terminal one would make every ordinal rule (past-screening, benchmarks,
  // move targets) answer nonsense while still type-checking.
  const entryIdx = live.stages.findIndex((s) => s.role === "entry");
  const terminalIdx = live.stages.findIndex((s) => s.role === "terminal");
  if (entryIdx !== 0) return { ok: false, error: "pipelineStages.stages must open with the entry stage." };
  if (terminalIdx !== live.stages.length - 1) return { ok: false, error: "pipelineStages.stages must end with the terminal stage." };

  // `retired` defaults to empty: an axis that has never dropped a column has no
  // tombstones, and requiring the key would break every hand-written config.
  const retiredRaw = raw.retired === undefined ? [] : raw.retired;
  const retired = validateStageList(retiredRaw, "pipelineStages.retired", PIPELINE_STAGES_MAX * 4);
  if (!retired.ok) return retired;
  const liveIds = new Set(live.stages.map((s) => s.id));
  const clash = retired.stages.find((s) => liveIds.has(s.id));
  if (clash) return { ok: false, error: `pipelineStages: "${clash.id}" is both live and retired.` };

  return { ok: true, phase: "pipelineStages", config: { stages: live.stages, retired: retired.stages } };
}

const isGate = (v: unknown): v is InterviewPlanGate => v === "auto" || v === "human";

/** One round, validated. `seq` is its index in the WHOLE plan (not in its
 *  column): the "first round has no cohort to reduce" rule is about the
 *  candidate's journey, so it must not reset at each column. `where` is the
 *  error path. */
function validatePlanRound(rec: Record<string, unknown>, seq: number, where: string): { ok: true; round: InterviewPlanRound } | { ok: false; error: string } {
  const strayR = Object.keys(rec).filter((k) => !(INTERVIEW_PLAN_ROUND_KEYS as readonly string[]).includes(k));
  if (strayR.length > 0) return { ok: false, error: `${where}: unknown key(s) ${strayR.join(", ")}.` };
  if (rec.kind !== "ai" && rec.kind !== "human") return { ok: false, error: `${where}.kind must be 'ai' or 'human'.` };
  if (!isGate(rec.gate)) return { ok: false, error: `${where}.gate must be 'auto' or 'human'.` };
  let topN: number | null = null;
  if (rec.topN !== null && rec.topN !== undefined) {
    if (typeof rec.topN !== "number" || !Number.isFinite(rec.topN)) {
      return { ok: false, error: `${where}.topN must be a number or null.` };
    }
    // Out-of-range but coercible → clamp (same posture as the 0–100 fields).
    topN = Math.max(1, Math.min(50, Math.round(rec.topN)));
  }
  return {
    ok: true,
    round: {
      kind: rec.kind,
      // A human round's verdict IS the human decision — never persist it as
      // unattended, whatever the client sent.
      gate: rec.kind === "human" ? "human" : rec.gate,
      // The plan's first round has no previous cohort to reduce.
      topN: seq === 0 ? null : topN,
    },
  };
}

/**
 * Accepts BOTH wire shapes.
 *
 * A blob written before the stage-keyed migration has no `steps`; it is
 * validated as the legacy shape and converted through
 * `migrateLegacyInterviewPlan`, so nothing has to be rewritten on disk for a
 * stored plan to keep working — the next save persists the new shape.
 *
 * The conversion here uses the DEFAULT axis, because a validator receives one
 * config and cannot see the workspace's `pipelineStages`. That is right for the
 * shipped column ids (which are stable under rename) and approximate for a
 * workspace that had ADDED interview columns — `getInterviewPlan` re-runs the
 * migration against the real axis, which is the path every reader actually uses.
 */
function validateInterviewPlan(raw: Record<string, unknown>): DecisionConfigResult {
  if (isLegacyInterviewPlan(raw)) return validateLegacyInterviewPlan(raw);

  const stray = Object.keys(raw).filter((k) => !(INTERVIEW_PLAN_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) return { ok: false, error: `interviewPlan: unknown key(s) ${stray.join(", ")}.` };
  if (!Array.isArray(raw.steps)) return { ok: false, error: "interviewPlan.steps must be an array." };

  const steps: InterviewPlanStep[] = [];
  const seen = new Set<string>();
  let seq = 0;
  for (const [i, s] of raw.steps.entries()) {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      return { ok: false, error: `interviewPlan.steps[${i}] must be an object.` };
    }
    const rec = s as Record<string, unknown>;
    const strayS = Object.keys(rec).filter((k) => !(INTERVIEW_PLAN_STEP_KEYS as readonly string[]).includes(k));
    if (strayS.length > 0) return { ok: false, error: `interviewPlan.steps[${i}]: unknown key(s) ${strayS.join(", ")}.` };
    if (typeof rec.stageId !== "string" || rec.stageId.trim() === "") {
      return { ok: false, error: `interviewPlan.steps[${i}].stageId must be a non-empty string.` };
    }
    // Two policies for one column is not a merge conflict the store can settle —
    // whichever won would be arbitrary, and the loser's gate would vanish
    // silently. Refused. (Which columns EXIST is the axis's business, checked at
    // read time by prunePlanToAxis; a validator sees one config, not both.)
    if (seen.has(rec.stageId)) return { ok: false, error: `interviewPlan: duplicate step for "${rec.stageId}".` };
    seen.add(rec.stageId);
    if (!isGate(rec.gate)) return { ok: false, error: `interviewPlan.steps[${i}].gate must be 'auto' or 'human'.` };

    const rawRounds = rec.rounds === undefined ? [] : rec.rounds;
    if (!Array.isArray(rawRounds)) return { ok: false, error: `interviewPlan.steps[${i}].rounds must be an array.` };
    const rounds: InterviewPlanRound[] = [];
    for (const [j, r] of rawRounds.entries()) {
      if (typeof r !== "object" || r === null || Array.isArray(r)) {
        return { ok: false, error: `interviewPlan.steps[${i}].rounds[${j}] must be an object.` };
      }
      const checked = validatePlanRound(r as Record<string, unknown>, seq, `interviewPlan.steps[${i}].rounds[${j}]`);
      if (!checked.ok) return checked;
      rounds.push(checked.round);
      seq += 1;
    }
    steps.push({ stageId: rec.stageId, gate: rec.gate, rounds });
  }
  // The cap counts ROUNDS across the plan, exactly as it did when they lived in
  // one flat array — spreading three rounds over three columns is the same
  // amount of interviewing as stacking them on one.
  if (seq > INTERVIEW_PLAN_MAX_ROUNDS) {
    return { ok: false, error: `interviewPlan: capped at ${INTERVIEW_PLAN_MAX_ROUNDS} rounds.` };
  }
  return { ok: true, phase: "interviewPlan", config: { steps } };
}

/** The pre-migration shape, validated with the old rules and then converted.
 *  Kept whole rather than folded into the new path: these are the rules that
 *  were in force when such a blob was written, and relaxing them retroactively
 *  would let a bad legacy blob through as if it had always been legal. */
function validateLegacyInterviewPlan(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(LEGACY_INTERVIEW_PLAN_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) return { ok: false, error: `interviewPlan: unknown key(s) ${stray.join(", ")}.` };
  if (!isGate(raw.screeningGate)) return { ok: false, error: "interviewPlan.screeningGate must be 'auto' or 'human'." };
  if (!isGate(raw.offerGate)) return { ok: false, error: "interviewPlan.offerGate must be 'auto' or 'human'." };
  if (!Array.isArray(raw.rounds)) return { ok: false, error: "interviewPlan.rounds must be an array." };
  if (raw.rounds.length > INTERVIEW_PLAN_MAX_ROUNDS) {
    return { ok: false, error: `interviewPlan.rounds is capped at ${INTERVIEW_PLAN_MAX_ROUNDS}.` };
  }
  const rounds: InterviewPlanRound[] = [];
  for (const [i, r] of raw.rounds.entries()) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      return { ok: false, error: `interviewPlan.rounds[${i}] must be an object.` };
    }
    const checked = validatePlanRound(r as Record<string, unknown>, i, `interviewPlan.rounds[${i}]`);
    if (!checked.ok) return checked;
    rounds.push(checked.round);
  }
  return {
    ok: true,
    phase: "interviewPlan",
    config: migrateLegacyInterviewPlan({ screeningGate: raw.screeningGate, rounds, offerGate: raw.offerGate }),
  };
}

function validateComplianceRule(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(COMPLIANCE_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown compliance rule field(s): ${stray.join(", ")}.` };
  }
  const j = raw.jurisdiction;
  if (typeof j !== "string" || !(REGIME_IDS as readonly string[]).includes(j)) {
    return { ok: false, error: `jurisdiction must be one of: ${REGIME_IDS.join(", ")}.` };
  }
  return { ok: true, phase: "compliance", config: { jurisdiction: j as RegimeId } };
}

/**
 * Validate the OPTIONAL per-family floor map. Same trust-boundary guarantees as the
 * global value, applied per entry: keys MUST be known role families (an unknown
 * family is rejected, not silently kept — the map stays bounded), values MUST be
 * finite numbers, and present out-of-range numbers are CLAMPED to 0–100 exactly like
 * `maxMatchToReject`. An ABSENT map returns `value: undefined` so the caller omits
 * the field entirely — keeping a plain screening rule byte-identical to before this
 * field existed (the shipped-default deepEqual tests depend on that).
 */
function validateFamilyFloors(
  raw: unknown
): { ok: true; value: Record<string, number> | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "familyFloors must be a plain object mapping role family → floor." };
  }
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ROLE_FAMILY_SLUGS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown role family in familyFloors: "${key}". Known families: ${ROLE_FAMILY_SLUGS.join(", ")}.` };
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `familyFloors.${key} must be a finite number.` };
    }
    out[key] = clampPercent(v);
  }
  return { ok: true, value: out };
}

function validateScreeningRule(raw: Record<string, unknown>): DecisionConfigResult {
  const stray = Object.keys(raw).filter((k) => !(SCREENING_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown screening rule field(s): ${stray.join(", ")}.` };
  }
  if (typeof raw.autoRejectEnabled !== "boolean") {
    return { ok: false, error: "autoRejectEnabled must be a boolean." };
  }
  for (const field of ["rejectBottomPercent", "maxMatchToReject"] as const) {
    const v = raw[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${field} must be a finite number.` };
    }
  }
  // holdoutPercent is OPTIONAL (like familyFloors): every rule saved before the
  // calibration holdout existed must keep validating unchanged, and an absent value
  // resolves via effectiveHoldoutPercent at point of use. Validated only when present.
  if (raw.holdoutPercent !== undefined) {
    if (typeof raw.holdoutPercent !== "number" || !Number.isFinite(raw.holdoutPercent)) {
      return { ok: false, error: "holdoutPercent must be a finite number." };
    }
  }
  const floors = validateFamilyFloors(raw.familyFloors);
  if (!floors.ok) return { ok: false, error: floors.error };
  const config: ScreeningRule = {
    autoRejectEnabled: raw.autoRejectEnabled,
    rejectBottomPercent: clampPercent(raw.rejectBottomPercent as number),
    maxMatchToReject: clampPercent(raw.maxMatchToReject as number),
  };
  // Only carry familyFloors when it was present — an absent map keeps the persisted
  // JSON (and a deepEqual against SCREENING_DEFAULT) byte-identical to before.
  if (floors.value !== undefined) config.familyFloors = floors.value;
  // Same "no phantom key" contract for the holdout rate.
  if (raw.holdoutPercent !== undefined) config.holdoutPercent = clampPercent(raw.holdoutPercent as number);
  return { ok: true, phase: "screening", config };
}

/**
 * Validate the OPTIONAL per-run `override` accepted by /api/decisions/screen-wave.
 *
 * Unlike a full config write, an override is a PARTIAL ScreeningRule — any subset
 * of the three known fields, merged over the saved config inside runScreenWave.
 * The same trust-boundary guarantees as validateDecisionConfig apply per PRESENT
 * field: stray keys are rejected, present fields are type-checked, and present
 * out-of-range numbers are CLAMPED to 0–100. An absent override (undefined/null)
 * is the no-op `{}` — run with the saved config — but a non-object override
 * (array, string, number) is a hard error: that's a malformed request, not
 * "no override".
 *
 * This closes the same catastrophe as the config boundary from the other side:
 * a raw `override` of { autoRejectEnabled:true, rejectBottomPercent:100,
 * maxMatchToReject:100 } would otherwise make the bottom-% the WHOLE cohort and
 * auto-reject every non-protected candidate — each firing an irreversible
 * rejection comm — straight past the modal's client-side clamps.
 *
 * On success returns ONLY the clamped known fields — never the raw body — so the
 * merge into runScreenWave's config can't carry a stray key or unclamped value.
 */
export function validateScreeningOverride(raw: unknown): ScreeningOverrideResult {
  if (raw === undefined || raw === null) return { ok: true, override: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "override must be a plain object." };
  }
  const obj = raw as Record<string, unknown>;
  const stray = Object.keys(obj).filter((k) => !(SCREENING_KEYS as readonly string[]).includes(k));
  if (stray.length > 0) {
    return { ok: false, error: `Unknown screening rule field(s): ${stray.join(", ")}.` };
  }
  const override: Partial<ScreeningRule> = {};
  if (obj.autoRejectEnabled !== undefined) {
    if (typeof obj.autoRejectEnabled !== "boolean") {
      return { ok: false, error: "autoRejectEnabled must be a boolean." };
    }
    override.autoRejectEnabled = obj.autoRejectEnabled;
  }
  for (const field of ["rejectBottomPercent", "maxMatchToReject", "holdoutPercent"] as const) {
    const v = obj[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { ok: false, error: `${field} must be a finite number.` };
    }
    override[field] = clampPercent(v);
  }
  // A present familyFloors override REPLACES the saved map wholesale (partial-merge
  // semantics are per top-level field); validated + clamped exactly like a full write.
  if (obj.familyFloors !== undefined) {
    const floors = validateFamilyFloors(obj.familyFloors);
    if (!floors.ok) return { ok: false, error: floors.error };
    if (floors.value !== undefined) override.familyFloors = floors.value;
  }
  return { ok: true, override };
}

/**
 * SMALL-COHORT POLICY for the screening auto-reject "bottom %" selection.
 *
 * `rejectBottomPercent` of a cohort of `n` rarely lands on a whole candidate.
 * The old `Math.floor((n * pct) / 100)` rounded DOWN, so any pool small enough
 * that the bottom-% came to less than one whole candidate rounded to 0 — the
 * default 20% over n=4 is floor(0.8)=0 — and that role was SILENTLY exempt from
 * an automation the recruiter had explicitly switched on (idea-582ff3b2).
 *
 * DECISION — floor, with a MINIMUM OF 1 in any non-empty cohort whenever a
 * positive percentage is configured. Rationale:
 *   • It targets the actual bug: the only behavior change versus the old floor
 *     is that a small pool can no longer round down to zero. Larger pools are
 *     untouched (n=10 @ 20% is 2 either way).
 *   • "Reject the bottom X%" should mean "act on the weakest", and the weakest
 *     of any non-empty pool is one candidate — not zero. `ceil` was rejected as
 *     too aggressive (it adds a candidate to large pools too); plain `round`
 *     still rounds the smallest pools (n≤2 @ 20%) to zero, leaving the bug.
 *   • It is not over-eager: the selected candidate is still only auto-rejected
 *     if they ALSO fall below `maxMatchToReject`, so a strong-but-small pool
 *     rejects nobody. A configured 0% (or empty cohort) still selects nobody.
 *
 * Mirrored verbatim in DecisionRulesModal's plain-English rule sentence so the
 * configured percentage matches what actually executes.
 */
export function screenBottomCount(cohortSize: number, rejectBottomPercent: number): number {
  if (cohortSize <= 0 || rejectBottomPercent <= 0) return 0;
  return Math.max(1, Math.floor((cohortSize * rejectBottomPercent) / 100));
}

/**
 * DETERMINISTIC TIE-BREAK at the auto-reject cutoff — keep equal scores on the
 * SAME side of the boundary.
 *
 * `screenBottomCount` answers "how many of the bottom to reject", but that count
 * can land in the MIDDLE of a run of candidates sharing the IDENTICAL match
 * score. The cohort is sorted ascending by score with JS's STABLE sort, so a tie
 * straddling the cutoff would be split purely by pipeline ARRIVAL ORDER — one
 * candidate auto-rejected, an indistinguishable peer kept, with no merit-based or
 * documented reason (idea-50062f77). That is indefensible for an irreversible
 * automated rejection and makes the boundary non-reproducible from the scores.
 *
 * DECISION — never split a tied score across the cutoff, resolved IN THE
 * CANDIDATE'S FAVOUR: when a tie straddles the boundary, shrink the reject window
 * to the lower edge of that tied run so the whole tied group is KEPT. Rationale:
 *   • The boundary becomes deterministic and reproducible from the scores alone,
 *     independent of insertion order — the exact property the bug violated — so
 *     equal candidates always get the equal outcome.
 *   • It matches this module's fail-closed stance: when automation cannot justify
 *     singling out one of several identical candidates, it rejects NONE of them
 *     rather than an arbitrary subset. Expanding the window (reject the whole tied
 *     run) was rejected as over-eager — it would auto-reject candidates the
 *     configured bottom-% never selected, purely because they tied with someone
 *     below the cutoff.
 *   • Only the straddling tie is spared: candidates with a strictly LOWER score
 *     than the tied run are unaffected and still auto-rejected.
 *
 * Takes the ascending-sorted GENUINE scores (worst first — the caller's null-score
 * policy excludes unscored candidates before ranking, so no fabricated 0 reaches
 * this cutoff; see screen-wave.ts) and the raw bottomCount; returns the tie-safe
 * count to reject (0 ≤ result ≤ bottomCount). Pure and order-independent for equal
 * scores, so it is unit-tested directly. Mirrors the keep-side rationale in
 * screen-wave.ts.
 */
export function tieSafeBottomCount(sortedScoresAsc: readonly number[], bottomCount: number): number {
  if (bottomCount <= 0) return 0;
  if (bottomCount >= sortedScoresAsc.length) return sortedScoresAsc.length;
  // The cutoff sits between index b-1 (last rejected) and b (first kept). While
  // those two share a score the cutoff is splitting a tied run — walk it DOWN to
  // the run's lower edge so the entire tied group lands on the keep side.
  let b = bottomCount;
  while (b > 0 && sortedScoresAsc[b - 1] === sortedScoresAsc[b]) b -= 1;
  return b;
}
