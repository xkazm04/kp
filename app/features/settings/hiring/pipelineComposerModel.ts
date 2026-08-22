// Pure model for the hiring-pipeline composer (Settings → Hiring): the plan a
// workspace composes (interview rounds + approval gates), the org-complexity
// presets, and the derived impact on the Hiring tabs (Overview / Decisions /
// Schedule). No JSX/hooks so it's unit-testable under node:test; the concept
// this implements is docs/concepts/interview-rounds.md (interviewPlan).
//
// PERSISTENCE: the plan is stored per workspace as the "interviewPlan" phase of
// the tiered decision-config store (decision-config-schema.ts owns the wire
// shape + validation).
//
// THE UI MODEL *IS* THE WIRE MODEL. There used to be a second, narrower shape
// here — one `screeningGate`, a flat `rounds` array, one `offerGate` — projected
// to and from storage on every load and save. It existed because the wire shape
// was role-keyed too, and it survived the stage-keyed migration as a temporary
// bridge. It is gone now: the merged step editor sets policy per COLUMN, which a
// role-level model cannot represent (two screening columns would share one
// gate), so a projection layer could only lose what the screen was built to
// express. `PipelinePlan` is an alias, not a translation — no round ids to mint,
// no round ids to drop, nothing to keep in sync.
import {
  INTERVIEW_PLAN_MAX_ROUNDS,
  migrateLegacyInterviewPlan,
  planRounds,
  planStep,
  type InterviewPlanGate,
  type InterviewPlanRound,
  type InterviewPlanRule,
  type InterviewPlanStep,
} from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS, stagesWithRole, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";

export type GateMode = InterviewPlanGate;
export type RoundKind = InterviewPlanRound["kind"];
export type PlanRound = InterviewPlanRound;
export type PlanStep = InterviewPlanStep;
/** The composed plan. Identical to what is stored — see the header. */
export type PipelinePlan = InterviewPlanRule;

export const MAX_ROUNDS = INTERVIEW_PLAN_MAX_ROUNDS;

export const newRound = (kind: RoundKind, gate: GateMode = "human", topN: number | null = null): PlanRound => ({
  kind,
  // A human round's verdict IS the human decision — the validator enforces this
  // on the way to storage; matching it here keeps the UI from ever showing a
  // toggle state that will not survive a save.
  gate: kind === "human" ? "human" : gate,
  topN,
});

/** A React list key for a round. Rounds have no id — they are a short ordered
 *  list inside one column, so position within that column names them, and the
 *  column's id is already unique. */
export const roundKey = (stageId: string, index: number): string => `${stageId}:${index}`;

export type PresetId = "lean" | "hybrid" | "enterprise";
export type Preset = { id: PresetId; plan: (axis?: readonly StageDef[]) => PipelinePlan };

/**
 * Build a preset: the INTENT, bound to whatever axis the workspace actually has.
 *
 * Authored in the pre-migration vocabulary and converted by
 * `migrateLegacyInterviewPlan`, for two reasons. It reads as the intent ("screen
 * unattended, one AI round, human offer") rather than as a list of stage ids the
 * author would have to guess; and binding it to the live axis means a preset never
 * mints a policy for a column the board does not draw.
 *
 * CLIPPED, not stacked. The migration puts surplus rounds on the last interview
 * column, which is right for reading an old plan faithfully and wrong for writing
 * a new one: one step runs one activity now. A preset that asks for more rounds
 * than the board has interview columns drops the extras rather than doubling them
 * up — the operator adds an Interview step and applies the preset again.
 */
function preset(id: PresetId, screeningGate: GateMode, rounds: PlanRound[], offerGate: GateMode): Preset {
  return {
    id,
    plan: (axis = DEFAULT_STAGE_AXIS) =>
      migrateLegacyInterviewPlan(
        { screeningGate, rounds: rounds.slice(0, stagesWithRole("interview", axis).length), offerGate },
        axis
      ),
  };
}

/** Org-complexity presets: solo founder → team → governance-heavy enterprise. */
export const PRESETS: Preset[] = [
  preset("lean", "auto", [newRound("ai", "human")], "human"),
  preset("hybrid", "human", [newRound("ai", "human"), newRound("human", "human", 3)], "human"),
  preset(
    "enterprise",
    "human",
    [newRound("ai", "human"), newRound("human", "human", 5), newRound("human", "human", 2)],
    "human"
  ),
];

// ---- Editing ---------------------------------------------------------------
//
// Every mutation returns a NEW plan; the editor holds it as state and the host
// decides when it reaches the server. A column with no step yet gets one on
// first touch — absence means "no policy", so the first edit is what creates it.

/** Set a column's approval gate, creating its step if the plan had none. */
export function setStepGate(plan: PipelinePlan, stageId: string, gate: GateMode): PipelinePlan {
  if (planStep(plan, stageId)) {
    return { steps: plan.steps.map((s) => (s.stageId === stageId ? { ...s, gate } : s)) };
  }
  return { steps: [...plan.steps, { stageId, gate, rounds: [] }] };
}

/** Replace a column's rounds wholesale (add, remove, re-kind, re-cohort). */
export function setStepRounds(plan: PipelinePlan, stageId: string, rounds: PlanRound[]): PipelinePlan {
  if (planStep(plan, stageId)) {
    return { steps: plan.steps.map((s) => (s.stageId === stageId ? { ...s, rounds } : s)) };
  }
  return { steps: [...plan.steps, { stageId, gate: rounds[0]?.gate ?? "human", rounds }] };
}

/** Patch one round of one column. */
export function patchRound(plan: PipelinePlan, stageId: string, index: number, patch: Partial<PlanRound>): PipelinePlan {
  const step = planStep(plan, stageId);
  if (!step) return plan;
  const rounds = step.rounds.map((r, i) => {
    if (i !== index) return r;
    const next = { ...r, ...patch };
    // Re-assert the invariant after ANY patch: flipping kind to human must also
    // drop an "auto" gate, or the UI would show a state the validator rewrites.
    return { ...next, gate: next.kind === "human" ? "human" : next.gate };
  });
  return setStepRounds(plan, stageId, rounds);
}

/** How many rounds the whole plan runs — the cap is a plan-wide budget, not a
 *  per-column one (spreading three rounds over three columns is the same amount
 *  of interviewing as stacking them on one). */
export function roundCount(plan: PipelinePlan): number {
  return planRounds(plan).length;
}

// ---- Derived impact --------------------------------------------------------

/** One column of the REAL board, annotated with what this plan runs there. */
export type PlanOverviewStation = {
  /** A stage id from the axis — the same id PipelineBoard renders as a column. */
  stageId: string;
  role: StageDef["role"];
  /** The plan's rounds that execute at this stage, in order. Empty for stages the
   *  plan says nothing about (the entry column, the terminal column). */
  rounds: RoundKind[];
};

/** What each Hiring tab would show under this plan — structured facts, the
 *  components own the copy. */
export type PlanImpact = {
  /** The Overview board's columns, in board order, annotated per station. */
  overview: PlanOverviewStation[];
  /** Human queues appearing in Decisions, in pipeline order. */
  decisions: ("screening_review" | "ai_scorecard_review" | "human_scorecard_review" | "offer_review")[];
  /** Which Schedule surfaces are in play. */
  schedule: { aiRound: boolean; humanRound: boolean };
  /** Human decision points per candidate who goes the distance. */
  humanTouchpoints: number;
};

/**
 * Derive the impact of a plan ON THE ACTUAL BOARD.
 *
 * This used to re-derive which column each round ran at, because the stored plan
 * did not say — rounds bound to interview stages left-to-right and any surplus
 * stacked on the last one. The plan says now (`InterviewPlanStep.stageId`), so
 * this reads the binding instead of inventing it, and a preview can no longer
 * disagree with what a save will persist.
 *
 * A column the plan says nothing about contributes no rounds and no queue —
 * absence stays absence, never a defaulted gate.
 */
export function deriveImpact(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): PlanImpact {
  const overview: PlanOverviewStation[] = axis.map((stage) => ({
    stageId: stage.id,
    role: stage.role,
    rounds: (planStep(plan, stage.id)?.rounds ?? []).map((r) => r.kind),
  }));

  const decisions: PlanImpact["decisions"] = [];
  // Board order, so the queues list the way a candidate meets them.
  for (const stage of axis) {
    const step = planStep(plan, stage.id);
    if (!step) continue;
    if (stage.role === "screening" && step.gate === "human") decisions.push("screening_review");
    for (const r of step.rounds) {
      if (r.kind === "human") decisions.push("human_scorecard_review");
      else if (r.gate === "human") decisions.push("ai_scorecard_review");
    }
    // A scoring column is the AI turning a conversation into a number; a human
    // guard on it is somebody ratifying that number, which is the same queue an
    // AI round's scorecard lands in.
    if (stage.role === "scoring" && step.gate === "human") decisions.push("ai_scorecard_review");
    if (stage.role === "offer" && step.gate === "human") decisions.push("offer_review");
  }

  const rounds = planRounds(plan);
  return {
    overview,
    decisions,
    schedule: {
      aiRound: rounds.some((r) => r.kind === "ai"),
      humanRound: rounds.some((r) => r.kind === "human"),
    },
    humanTouchpoints: decisions.length,
  };
}

/** The board stage each fixed composer row governs, so a policy surface names
 *  the same columns the board draws instead of its own private station words.
 *
 *  A function of the axis, not a module constant: the axis is per-workspace data
 *  and, in the composer, a live DRAFT — a frozen lookup would label the policy
 *  rows with the shipped column names while the reader was busy renaming them. */
export function composerStations(axis: readonly StageDef[] = DEFAULT_STAGE_AXIS) {
  return {
    screening: stageWithRole("screening", axis),
    interview: stagesWithRole("interview", axis),
    offer: stageWithRole("offer", axis),
  };
}

/** Structural equality against the last-saved plan — drives the dirty state that
 *  gates the Save button. A plain comparison now that the UI and wire shapes are
 *  the same object; step ORDER is not meaningful, so it is normalized away. */
export function planEqualsStored(plan: PipelinePlan, stored: PipelinePlan): boolean {
  const norm = (p: PipelinePlan) => JSON.stringify([...p.steps].sort((a, b) => a.stageId.localeCompare(b.stageId)));
  return norm(plan) === norm(stored);
}

/** Does the composed plan match a preset structurally? Used to highlight the
 *  active blueprint after fine-tuning. Compared against the preset built for the
 *  SAME axis — a preset is an intent, and its shape depends on the board. */
export function matchesPreset(plan: PipelinePlan, preset: Preset, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): boolean {
  return planEqualsStored(plan, preset.plan(axis));
}
