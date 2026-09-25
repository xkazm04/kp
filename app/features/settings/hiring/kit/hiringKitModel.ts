// Settings > Hiring, composed from the kit (Gate 1): the data-to-rows mapping, as pure functions.
//
// The kit view reads the SAME state the current tab does (useHiringComposer: the axis draft, the
// plan draft, occupancy, the stranded mapping) and edits it through the SAME model functions
// (pipelineAxisDraft, pipelineComposerModel). What lives here is only the kit's own reading of
// that state: one row per step, one row per decision a step carries, which marks those rows
// wear, what changed against the stored plan, and the page head's figures. No React, no fetch.
import { planStep } from "@/app/_lib/decision-config-schema";
import type { StageAiAction, StageDef, StageRole } from "@/app/_lib/pipeline-stages";
import { defaultStageActions, stageActions } from "@/app/_lib/stage-ai-actions";
import type { AxisDraft, StrandedStage } from "@/app/features/shared/pipelineAxisDraft";
import type { BlockedReason } from "../composerState";
import type { useHiringComposer } from "../useHiringComposer";
import {
  deriveImpact,
  newRound,
  patchRound,
  roundCount,
  setStepGate,
  setStepRounds,
  type GateMode,
  type PipelinePlan,
  type PlanRound,
  type RoundKind,
} from "../pipelineComposerModel";

/** What the view's sections receive: the current tab's own hook, whole. */
export type Composer = ReturnType<typeof useHiringComposer>;

/** A draft stage as the rows read it (the axis draft's stages, minus the draft-only flag). */
export type KitStage = Pick<StageDef, "id" | "label" | "role" | "actions">;

export type StepRow = {
  id: string;
  label: string;
  role: StageRole;
  /** False for a step this draft added: it has no stored key yet and holds nobody. */
  saved: boolean;
  /** Candidates standing here; null until the occupancy read lands (never a guessed 0). */
  count: number | null;
  /** Differs from the stored axis: new, renamed, re-typed, re-scoped actions, or moved. */
  changed: boolean;
  /** Its name is empty or repeats another step's (the two label problems axisProblems names). */
  invalid: boolean;
  first: boolean;
  last: boolean;
};

const labelKey = (label: string) => label.trim().toLowerCase();

export function stepRows(
  draft: AxisDraft,
  savedStages: readonly StageDef[],
  counts: Record<string, number>,
  countsLoaded: boolean,
): StepRow[] {
  const seen = new Map<string, number>();
  for (const s of draft.stages) if (labelKey(s.label)) seen.set(labelKey(s.label), (seen.get(labelKey(s.label)) ?? 0) + 1);
  const n = draft.stages.length;
  // MOVED is judged on the order of the columns both sides still have: removing or adding a column
  // shifts every index after it, and marking those rows changed would blame the reader for a move
  // they never made.
  const liveIds = new Set(draft.stages.map((s) => s.id));
  const savedIds = new Set(savedStages.map((s) => s.id));
  const wasOrder = savedStages.map((s) => s.id).filter((id) => liveIds.has(id));
  const nowOrder = draft.stages.map((s) => s.id).filter((id) => savedIds.has(id));
  return draft.stages.map((s, i) => {
    const was = savedStages.find((x) => x.id === s.id) ?? null;
    const changed =
      !s.saved ||
      !was ||
      was.label !== s.label ||
      was.role !== s.role ||
      JSON.stringify(was.actions ?? null) !== JSON.stringify(s.actions ?? null) ||
      wasOrder.indexOf(s.id) !== nowOrder.indexOf(s.id);
    return {
      id: s.id,
      label: s.label,
      role: s.role,
      saved: s.saved,
      count: !countsLoaded ? null : s.saved ? (counts[s.id] ?? 0) : 0,
      changed,
      invalid: labelKey(s.label) === "" || (seen.get(labelKey(s.label)) ?? 0) > 1,
      first: i === 0,
      last: i === n - 1,
    };
  });
}

// ---- the decisions each step carries -------------------------------------------------------

/** Types that carry policy at all - PipelineStepPolicy's `stepCarriesPolicy`, which lives in a
 *  .tsx and so cannot be imported here. Entry, terminal and custom carry none (a guard on a column
 *  the product has no semantics for would be a switch wired to nothing). */
export const POLICY_ROLES: readonly StageRole[] = ["screening", "homework", "interview", "scoring", "offer"];

export type PolicyDim = "cohort" | "executor" | "guard" | "scorecard";

export type PolicyRow = {
  key: string;
  stageId: string;
  role: StageRole;
  dim: PolicyDim;
  /** guard: GateMode · executor: RoundKind · cohort: top N or null (everyone) · scorecard: null. */
  value: GateMode | RoundKind | number | null;
  changed: boolean;
  /** On the executor row: rounds a legacy plan stacked behind this column (> 1 = say so). */
  stacked?: number;
};

/**
 * One row per decision, in board order - the three policy slots of the current table
 * (cohort, executor, guard), each as its own setting row. Same rules as PipelineStepPolicy:
 * an untouched column reads as its conservative default (a person approves; an interview is an
 * AI round nobody has approved yet), a cohort is offered only after a previous round, and a
 * human round's verdict IS the decision (the scorecard row states it, nothing to choose).
 */
export function policyRows(plan: PipelinePlan, savedPlan: PipelinePlan | null, stages: readonly KitStage[]): PolicyRow[] {
  const rows: PolicyRow[] = [];
  let roundsBefore = 0;
  for (const stage of stages) {
    const step = planStep(plan, stage.id);
    const was = savedPlan ? planStep(savedPlan, stage.id) : null;
    const rounds = step?.rounds ?? [];
    const before = roundsBefore;
    roundsBefore += rounds.length;
    if (!POLICY_ROLES.includes(stage.role)) continue;
    const base = { stageId: stage.id, role: stage.role };
    if (stage.role !== "interview") {
      const gate = step?.gate ?? "human";
      rows.push({ ...base, key: `${stage.id}:guard`, dim: "guard", value: gate, changed: gate !== (was?.gate ?? "human") });
      continue;
    }
    const round = rounds[0] ?? newRound("ai");
    const old = was?.rounds[0] ?? newRound("ai");
    if (before > 0) rows.push({ ...base, key: `${stage.id}:cohort`, dim: "cohort", value: round.topN, changed: round.topN !== old.topN });
    rows.push({
      ...base,
      key: `${stage.id}:executor`,
      dim: "executor",
      value: round.kind,
      changed: round.kind !== old.kind,
      ...(rounds.length > 1 ? { stacked: rounds.length } : {}),
    });
    rows.push(
      round.kind === "human"
        ? { ...base, key: `${stage.id}:scorecard`, dim: "scorecard", value: null, changed: false }
        : { ...base, key: `${stage.id}:guard`, dim: "guard", value: round.gate, changed: round.gate !== old.gate || old.kind !== "ai" },
    );
  }
  return rows;
}

/** Apply one row's new value - the same plan edits PipelineStepPolicy makes. An interview column
 *  the plan has not met yet gets its default round written on this first edit, not on render. */
export function setPolicy(
  plan: PipelinePlan,
  row: Pick<PolicyRow, "stageId" | "role" | "dim">,
  value: GateMode | RoundKind | number | null,
): PipelinePlan {
  if (row.role !== "interview") return row.dim === "guard" ? setStepGate(plan, row.stageId, value as GateMode) : plan;
  const patch: Partial<PlanRound> =
    row.dim === "executor"
      ? { kind: value as RoundKind }
      : row.dim === "guard"
        ? { gate: value as GateMode }
        : row.dim === "cohort"
          ? { topN: value as number | null }
          : {};
  const rounds = planStep(plan, row.stageId)?.rounds ?? [];
  return rounds.length > 0 ? patchRound(plan, row.stageId, 0, patch) : setStepRounds(plan, row.stageId, [{ ...newRound("ai"), ...patch }]);
}

// ---- the page head's figures ------------------------------------------------------------------------

/** The page head's figures and their change against the STORED plan on the STORED axis. */
export function planFigures(
  plan: PipelinePlan,
  axis: readonly KitStage[],
  savedPlan: PipelinePlan | null,
  savedAxis: readonly KitStage[],
): { decisions: number; decisionsDelta: number; rounds: number; roundsDelta: number } {
  const decisions = deriveImpact(plan, axis as StageDef[]).humanTouchpoints;
  const rounds = roundCount(plan, axis as StageDef[]);
  if (!savedPlan) return { decisions, decisionsDelta: 0, rounds, roundsDelta: 0 };
  return {
    decisions,
    decisionsDelta: decisions - deriveImpact(savedPlan, savedAxis as StageDef[]).humanTouchpoints,
    rounds,
    roundsDelta: rounds - roundCount(savedPlan, savedAxis as StageDef[]),
  };
}

// ---- AI actions, strandings, the save line --------------------------------------------------------

export type ActionRow = { id: string; current: StageAiAction[]; defaults: StageAiAction[]; custom: boolean };

export function actionRows(stages: readonly KitStage[]): ActionRow[] {
  const axis = stages as StageDef[];
  return stages.map((s) => ({
    id: s.id,
    current: stageActions(s.id, axis),
    defaults: defaultStageActions(s.id, axis),
    custom: s.actions !== undefined,
  }));
}

export type StrandedRow = { id: string; label: string; count: number; target: string; unmapped: boolean };

/** A destination must still exist on the draft (composerState's `unmapped` rule). */
export function strandedRows(
  stranded: readonly StrandedStage[],
  mapping: Record<string, string>,
  stages: readonly KitStage[],
): StrandedRow[] {
  const live = new Set(stages.map((s) => s.id));
  return stranded.map((s) => {
    const target = mapping[s.stage.id] ?? "";
    return { id: s.stage.id, label: s.stage.label, count: s.count, target, unmapped: !live.has(target) };
  });
}

/** The save bar's sentence - HiringTab's order: the reason a save is refused wins over "unsaved". */
export function saveStatusKey(reason: BlockedReason, dirty: boolean) {
  if (reason === "occupancy") return "blockedOccupancy" as const;
  if (reason === "unmapped") return "blockedStranded" as const;
  if (reason === "problems") return "blocked" as const;
  return dirty ? ("unsaved" as const) : ("allSaved" as const);
}

// ---- the matrix: one row per step ------------------------------------------------------------------

/** Who decides at a column: a person, the machine unattended, or nothing is decided there. */
export type Decider = "human" | "machine" | "nobody";

/** One step as the matrix draws it: the column, its decisions, its AI actions, and the mark the
 *  row wears - who decides there AS THE CONTROLS SHOW IT (an untouched interview column reads as the
 *  AI round nobody has approved yet, so its row says "a person decides", matching its controls). */
export type MatrixRow = StepRow & {
  policy: PolicyRow[];
  actions: ActionRow;
  decider: Decider;
  /** Rounds a legacy plan stacked behind this column, when more than one. */
  stacked: number | null;
  /** The step itself changed, or any decision on it did. */
  dirty: boolean;
};

export function matrixRows(
  draft: AxisDraft,
  savedStages: readonly StageDef[],
  counts: Record<string, number>,
  countsLoaded: boolean,
  plan: PipelinePlan,
  savedPlan: PipelinePlan | null,
): MatrixRow[] {
  const policy = policyRows(plan, savedPlan, draft.stages);
  const actions = new Map(actionRows(draft.stages).map((a) => [a.id, a]));
  return stepRows(draft, savedStages, counts, countsLoaded).map((s) => {
    const mine = policy.filter((p) => p.stageId === s.id);
    const human = mine.some((p) => p.dim === "scorecard" || (p.dim === "guard" && p.value === "human"));
    const decides = mine.some((p) => p.dim === "guard" || p.dim === "scorecard");
    return {
      ...s,
      policy: mine,
      actions: actions.get(s.id)!,
      decider: human ? "human" : decides ? "machine" : "nobody",
      stacked: mine.find((p) => p.stacked)?.stacked ?? null,
      dirty: s.changed || mine.some((p) => p.changed),
    };
  });
}

/** The latest time either half of the plan was stored, or null when neither ever was. */
export function latestVersion(versions: Record<string, string | null>, phases: readonly string[]): string | null {
  const stamps = phases.map((p) => versions[p]).filter((v): v is string => Boolean(v));
  return stamps.length ? stamps.sort().at(-1)! : null;
}
