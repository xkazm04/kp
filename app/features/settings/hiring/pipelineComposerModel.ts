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
  planStep,
  prunePlanToAxis,
  type InterviewPlanGate,
  type InterviewPlanRound,
  type InterviewPlanRule,
  type InterviewPlanStep,
} from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS, stagesWithRole, stageWithRole, type StageDef, type StageRole } from "@/app/_lib/pipeline-stages";
import { mintStageId, type AxisDraft, type DraftStage } from "@/app/features/shared/pipelineAxisDraft";

export type GateMode = InterviewPlanGate;
export type RoundKind = InterviewPlanRound["kind"];
export type PlanRound = InterviewPlanRound;
export type PlanStep = InterviewPlanStep;
/** The composed plan. Identical to what is stored — see the header. */
export type PipelinePlan = InterviewPlanRule;

export const MAX_ROUNDS = INTERVIEW_PLAN_MAX_ROUNDS;

/** Shortcuts the cohort Select leads with. The validator accepts 1–50; these
 *  are the common N, not the legal range. */
export const COHORT_SHORTCUT_NS = [2, 3, 5, 8] as const;
export const COHORT_N_MIN = 1;
export const COHORT_N_MAX = 50;

/** Every legal top-N, shortcuts first so 2/3/5/8 stay one click and a stored 10
 *  still has a matching option. */
export function cohortSelectNs(): number[] {
  const lead = [...COHORT_SHORTCUT_NS];
  const seen = new Set<number>(lead);
  const rest: number[] = [];
  for (let n = COHORT_N_MIN; n <= COHORT_N_MAX; n++) {
    if (!seen.has(n)) rest.push(n);
  }
  return [...lead, ...rest];
}

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

/** The labels a preset needs for the columns it INVENTS or re-purposes. Passed in
 *  localized by the editor: a preset must never mint English column names into a
 *  Czech workspace's board, and it must never mint an id from a localized string
 *  either (ids are storage keys — see `mintStageId`). */
export type PresetAxisLabels = {
  homework: string;
  aiInterview: string;
  screened: string;
  humanInterview: string;
  offer: string;
};

export type Preset = {
  id: PresetId;
  plan: (axis?: readonly StageDef[]) => PipelinePlan;
  /** A preset that rewrites the BOARD, not just the policy on it. Absent ⇒ the
   *  preset keeps whatever columns the workspace has. */
  axis?: (base: AxisDraft, labels: PresetAxisLabels) => AxisDraft;
  /** The role signature the rewritten axis has. Read by `matchesPreset` so an
   *  axis-rewriting preset only reads as ACTIVE on the board it actually describes
   *  — otherwise its plan, clipped onto a five-column board, is indistinguishable
   *  from the next preset down. */
  axisRoles?: readonly StageRole[];
};

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
function preset(
  id: PresetId,
  screeningGate: GateMode,
  rounds: PlanRound[],
  offerGate: GateMode,
  shape?: Pick<Preset, "axis" | "axisRoles">
): Preset {
  return {
    id,
    plan: (axis = DEFAULT_STAGE_AXIS) => {
      const migrated = migrateLegacyInterviewPlan(
        { screeningGate, rounds: rounds.slice(0, stagesWithRole("interview", axis).length), offerGate },
        axis
      );
      // A case step is not in the legacy vocabulary, so the migration emits nothing
      // for it. Every preset gives one a HUMAN gate: sending a candidate an
      // assignment costs them hours of unpaid work, and "nobody chose" must not
      // resolve to "the machine sends it unattended".
      const homework = stagesWithRole("homework", axis);
      if (homework.length === 0) return migrated;
      return sortPlanToAxis(
        { steps: [...migrated.steps, ...homework.map((stageId) => ({ stageId, gate: "human" as GateMode, rounds: [] }))] },
        axis
      );
    },
    ...shape,
  };
}

/** The Enterprise funnel's columns, in order, as ROLES. Declared once: the builder
 *  below produces it and `matchesPreset` recognises it. */
export const ENTERPRISE_AXIS_ROLES: readonly StageRole[] = [
  "entry",
  "homework",
  "interview",
  "screening",
  "interview",
  "offer",
  "terminal",
];

/** Locale-independent seeds for the two columns this preset may have to MINT. Ids
 *  are storage keys (`pipeline_entries.stage`, the ATS field map), so they must not
 *  differ per locale — the same rule the wizard's work-sample preset works under. */
const ENTERPRISE_ID_SEEDS = { homework: "Homework", humanInterview: "Human interview" } as const;

/**
 * Enterprise governance, as a BOARD rather than as policy on somebody else's board.
 *
 * "Rewrite the columns if different functionality is bound to them": the two-
 * interview funnel needs a case step (the devcase module runs there), an AI round
 * grounded in that case, a HUMAN triage after it, and a human round — which is a
 * different axis, not a different set of gates on the shipped five.
 *
 * It is an EDIT of the loaded axis, never a fresh board: every column that can be
 * reused by role keeps its stored id, so applying the preset strands nobody who is
 * standing on Accepted / Interview / Screened / Offer / Hired. Columns the target
 * funnel has no place for ARE dropped — deliberately, that is the rewrite — and the
 * host's existing stranded-mapping refusal is what stops anybody vanishing with them
 * (see useHiringComposer / composerState: a dropped column with occupants blocks Save
 * until the reader names a destination, and the move ships in the same request).
 */
function enterpriseAxis(base: AxisDraft, labels: PresetAxisLabels): AxisDraft {
  const taken = [...base.stages.map((s) => s.id), ...base.retired.map((s) => s.id)];
  const used = new Set<string>();
  /** Reuse the first unclaimed column with this role, else mint one. */
  const column = (role: StageRole, seed: string, label: string | null): DraftStage => {
    const found = base.stages.find((s) => s.role === role && !used.has(s.id));
    if (found) {
      used.add(found.id);
      return { ...found, role, ...(label ? { label } : {}) };
    }
    const id = mintStageId(seed, taken);
    taken.push(id);
    return { id, label: label ?? id, role, saved: false };
  };
  return {
    ...base,
    stages: [
      // Entry and terminal keep their own names: they are the two columns every
      // axis already has, and a preset has no business renaming "Accepted".
      column("entry", "Accepted", null),
      column("homework", ENTERPRISE_ID_SEEDS.homework, labels.homework),
      column("interview", "Interview", labels.aiInterview),
      column("screening", "Screened", labels.screened),
      column("interview", ENTERPRISE_ID_SEEDS.humanInterview, labels.humanInterview),
      column("offer", "Offer", labels.offer),
      column("terminal", "Hired", null),
    ],
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
    "human",
    { axis: enterpriseAxis, axisRoles: ENTERPRISE_AXIS_ROLES }
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

/**
 * THE PLAN AS THE SERVER WILL READ IT — the only shape a preview may reason from.
 *
 * The composer is the one reader in the product that sees the plan RAW: it loads
 * `/api/decisions/config` (`getAllDecisionConfigs`), while every server consumer
 * goes through `getInterviewPlan`, which `prunePlanToAxis`-es first. So the blob
 * the editor holds can name a column this axis does not draw (the draft just
 * removed it; an org-baseline plan was authored against a different axis) or one
 * that cannot hold policy at all (a column re-roled to entry/terminal). Those
 * steps are already dead — the very next server read drops them — and a preview
 * built on them promises interviews that will never run.
 *
 * Reusing the server's own function rather than re-deriving "which columns count"
 * is the point: there is one rule, and the preview is on the same side of it as
 * the runtime.
 */
function planOnAxis(plan: PipelinePlan, axis: readonly StageDef[]): PipelinePlan {
  return prunePlanToAxis(plan, axis);
}

/** How many rounds the plan runs on this board — the cap is a plan-wide budget,
 *  not a per-column one (spreading three rounds over three columns is the same
 *  amount of interviewing as stacking them on one). Axis-scoped for the same
 *  reason `deriveImpact` is: a round at a column this board does not draw is not
 *  a booking anybody will make. */
export function roundCount(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): number {
  return planOnAxis(plan, axis).steps.reduce((n, s) => n + s.rounds.length, 0);
}

/**
 * The plan's steps re-ordered to match the board — what a SAVE must send.
 *
 * The wire shape is order-sensitive in one place: the validator numbers rounds by
 * their position in `steps` to decide which is the plan's FIRST (the one that has
 * no previous cohort to reduce, so its `topN` is nulled). The editor, meanwhile,
 * appends a column's step on first touch and never reorders — so a column added
 * and then moved earlier leaves the array disagreeing with the board, and the
 * validator strips the reducer off the wrong round. `prunePlanToAxis` sorts on
 * READ, which hides the divergence from every consumer and from nobody at all on
 * the way in.
 *
 * Steps for columns this axis does not draw sort LAST (stable, so their relative
 * order survives): they are pruned on the next read, and letting one hold
 * position 0 would hand the reducer exemption to a round that is about to vanish.
 */
export function sortPlanToAxis(plan: PipelinePlan, axis: readonly StageDef[]): PipelinePlan {
  const order = new Map(axis.map((s, i) => [s.id, i]));
  const rank = (stageId: string) => order.get(stageId) ?? Number.MAX_SAFE_INTEGER;
  return { steps: [...plan.steps].sort((a, b) => rank(a.stageId) - rank(b.stageId)) };
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
  decisions: ("screening_review" | "homework_review" | "ai_scorecard_review" | "human_scorecard_review" | "offer_review")[];
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
 *
 * Every reading below is taken from the plan AS THE SERVER WILL READ IT
 * (`planOnAxis`), so a step the next read prunes cannot light up a card here.
 */
export function deriveImpact(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): PlanImpact {
  const live = planOnAxis(plan, axis);
  const overview: PlanOverviewStation[] = axis.map((stage) => ({
    stageId: stage.id,
    role: stage.role,
    rounds: (planStep(live, stage.id)?.rounds ?? []).map((r) => r.kind),
  }));

  const decisions: PlanImpact["decisions"] = [];
  // Board order, so the queues list the way a candidate meets them.
  for (const stage of axis) {
    const step = planStep(live, stage.id);
    if (!step) continue;
    if (stage.role === "screening" && step.gate === "human") decisions.push("screening_review");
    // Sending a case is a real human decision — it spends the candidate's unpaid
    // hours — so a human-gated homework column is a touchpoint like any other.
    if (stage.role === "homework" && step.gate === "human") decisions.push("homework_review");
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

  // Off the LIVE plan, not the whole blob: a round at a column this draft no
  // longer draws lights up no Schedule surface, because the server prunes that
  // step before anything schedules anything. Reading it here used to make this
  // card promise an AI docket while Overview, which walks the axis, showed the
  // board running nothing at all.
  const rounds = live.steps.flatMap((s) => s.rounds);
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

/** How the Overview mini-board paints live occupancy under a station.
 *  Unknown must omit rather than guess 0: a missing fetch must not look empty. */
export type OccupancyMark = "omit" | "empty" | number;

export function occupancyMark(countsLoaded: boolean, count: number | undefined): OccupancyMark {
  if (!countsLoaded) return "omit";
  const n = count ?? 0;
  return n > 0 ? n : "empty";
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
  // A preset that rewrites the BOARD is only itself on that board. Without this,
  // Enterprise clipped onto the shipped five columns produces the same policy as
  // Team hybrid — the two would light up together and the reader could not tell
  // which shape they were looking at.
  if (preset.axisRoles && axis.map((s) => s.role).join(">") !== preset.axisRoles.join(">")) return false;
  return planEqualsStored(plan, preset.plan(axis));
}

/** Which preset this board+plan IS, or null. Checked in REVERSE declaration order
 *  so the most specific shape (the one that pins an axis) is asked first. */
export function activePresetId(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): PresetId | null {
  return [...PRESETS].reverse().find((p) => matchesPreset(plan, p, axis))?.id ?? null;
}
