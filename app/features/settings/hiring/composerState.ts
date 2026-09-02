// The Hiring composer's STATE COMPOSITION, as pure functions.
//
// useHiringComposer used to compute all of this inline, which made three rules
// untestable and one of them wrong: `blocked` folded "the draft has problems",
// "a removal has no destination" and "the occupancy read failed" into one
// boolean, so a failed occupancy read painted "fix the problems above" over a
// page with no problems on it. A reason the UI can name has to be a value, not a
// boolean — so it is derived here, once, and unit-tested.
//
// Nothing in this module touches React or fetch: the hook owns the state cells
// and the IO, this owns the rules that read them.
import type { InterviewPlanRule, PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import {
  axisEqualsStored,
  axisProblems,
  draftFromStored,
  strandedByDraft,
  type AxisDraft,
  type AxisProblem,
  type StrandedStage,
} from "@/app/features/shared/pipelineAxisDraft";
import { planEqualsStored, type PipelinePlan } from "./pipelineComposerModel";

export type ComposerInputs = {
  axis: AxisDraft | null;
  savedAxis: PipelineStagesRule | null;
  plan: PipelinePlan | null;
  savedPlan: InterviewPlanRule | null;
  counts: Record<string, number>;
  /** False until the occupancy read has landed — a failed read leaves it false. */
  countsLoaded: boolean;
  mapping: Record<string, string>;
};

/** WHY a save is refused. The UI paints a different sentence per reason: the
 *  occupancy one is not about the draft at all, and telling the reader to "fix
 *  the problems above" when there are none is how a blocked-but-empty page
 *  happens. */
export type BlockedReason = "problems" | "unmapped" | "occupancy" | null;

export type ComposerState = {
  savedStages: StageDef[];
  problems: AxisProblem[];
  stranded: StrandedStage[];
  /** Stranded stages whose destination is missing or no longer on the draft. */
  unmapped: StrandedStage[];
  axisDirty: boolean;
  planDirty: boolean;
  dirty: boolean;
  blocked: boolean;
  blockedReason: BlockedReason;
};

export function deriveComposerState(i: ComposerInputs): ComposerState {
  const savedStages: StageDef[] = i.savedAxis?.stages.map((s) => ({ ...(s as StageDef) })) ?? [];
  const problems = i.axis ? axisProblems(i.axis) : [];
  // Occupancy is advisory for RENDERING and load-bearing for REMOVAL: a missing
  // count must never make a removal look safe, so stranding is only computed
  // from a landed read.
  const stranded = i.axis && i.countsLoaded ? strandedByDraft(i.axis, savedStages, i.counts) : [];
  const axisDirty = i.axis != null && i.savedAxis != null && !axisEqualsStored(i.axis, i.savedAxis, savedStages);
  const planDirty = i.plan != null && i.savedPlan != null && !planEqualsStored(i.plan, i.savedPlan);
  // A removal we cannot account for is refused, not warned about: the occupancy
  // read failed, so a count of 0 would be a guess rather than a fact.
  const occupancyBlocks = i.axis != null && i.savedAxis != null && !i.countsLoaded && droppedAny(i.axis, savedStages);
  // A destination must still EXIST in the draft — removing the column someone was
  // mapped onto silently invalidates the mapping, and the reader must re-answer.
  const liveIds = new Set(i.axis?.stages.map((s) => s.id) ?? []);
  const unmapped = stranded.filter((s) => !liveIds.has(i.mapping[s.stage.id] ?? ""));
  const blockedReason: BlockedReason =
    problems.length > 0 ? "problems" : unmapped.length > 0 ? "unmapped" : occupancyBlocks ? "occupancy" : null;
  return {
    savedStages,
    problems,
    stranded,
    unmapped,
    axisDirty,
    planDirty,
    dirty: axisDirty || planDirty,
    blocked: blockedReason != null,
    blockedReason,
  };
}

/** Does this draft drop any saved stage at all? Used only to decide whether a
 *  missing occupancy read is a blocker — a draft that removes nothing is safe to
 *  save regardless of what we know about counts. */
function droppedAny(draft: AxisDraft, savedStages: readonly StageDef[]): boolean {
  const live = new Set(draft.stages.map((s) => s.id));
  return savedStages.some((s) => !live.has(s.id));
}

/** The migration legs this save actually needs: exactly the stranded stages, in
 *  the destinations the reader chose. A stale mapping entry for a stage the
 *  reader put back must not move anybody. */
export function migrateMapFor(stranded: readonly StrandedStage[], mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of stranded) out[s.stage.id] = mapping[s.stage.id];
  return out;
}

/** Discard: BOTH drafts go back to what is stored, and the migration answers with
 *  them — a destination chosen for a removal that is being undone is not an
 *  answer to any question the reader is still being asked. */
export function restoreDrafts(
  savedPlan: InterviewPlanRule | null,
  savedAxis: PipelineStagesRule | null,
  current: { plan: PipelinePlan | null; axis: AxisDraft | null }
): { plan: PipelinePlan | null; axis: AxisDraft | null; mapping: Record<string, string> } {
  return {
    plan: savedPlan ?? current.plan,
    axis: savedAxis ? draftFromStored(savedAxis) : current.axis,
    mapping: {},
  };
}

// ---- the save, minus React -------------------------------------------------

export type ComposerRefresh = {
  configs?: { interviewPlan?: InterviewPlanRule; pipelineStages?: PipelineStagesRule };
  /** The concurrency tokens the refreshed configs were read at. */
  versions?: Record<string, string | null>;
  counts?: Record<string, number>;
};

export type SaveIo = {
  /** Axis + the candidate moves it forces, as ONE request. */
  applyAxis(): Promise<void>;
  writePlan(): Promise<void>;
  /** The two post-save re-reads. Throws if either fails. */
  refresh(): Promise<ComposerRefresh>;
};

/** What a save attempt actually did. The distinction the old inline version did
 *  not draw: a failed post-save RE-READ is not a failed save — both writes are
 *  committed, and reporting "save failed" over a landed write is a lie that
 *  invites the reader to save again. */
export type SaveOutcome =
  | { kind: "write-failed"; error: unknown }
  | { kind: "saved"; refresh: "ok"; data: ComposerRefresh }
  | { kind: "saved"; refresh: "failed" };

export async function runComposerSave(
  input: { axisDirty: boolean; planDirty: boolean },
  io: SaveIo
): Promise<SaveOutcome> {
  try {
    // The axis is saved BEFORE the plan, deliberately: the plan's stations resolve
    // against the axis, so persisting a plan that references a column the stored
    // axis does not have yet would leave a window where the two disagree.
    if (input.axisDirty) await io.applyAxis();
    if (input.planDirty) await io.writePlan();
  } catch (error) {
    return { kind: "write-failed", error };
  }
  try {
    return { kind: "saved", refresh: "ok", data: await io.refresh() };
  } catch {
    // Deliberately swallowed: the writes are committed and the reader is told so.
    // The stale view gets its own line and its own retry, not a failure toast.
    return { kind: "saved", refresh: "failed" };
  }
}
