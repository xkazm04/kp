/*
 * The kit view's stage moves, pure (the parity port of the retired board's move rules). Recovered from
 * the deleted subwayInteraction.ts (the "Move to" menu, the keyboard twin of the drag) and
 * lineActions.ts (the role row's Accept all / Reject all / AI evaluate cohort). The kit has no board
 * to drag on, so a move is a menu pick (the pane, the row's act track, `m`); legality is still
 * moveTargetStages: never the entry's own stage, never the terminal ROLE (a renamed "Placed" refuses
 * exactly like "Hired").
 */
import { stagesWithRole, type StageDef } from "../../../../_lib/pipeline-stages.ts";
import type { PipelineBatchItem } from "../../../../_lib/useAddToPipeline.ts";
import { entryLaneKey, type Entry } from "../../../shared/pipelineTypes.ts";
import { moveTargetStages } from "../pipelineMoveTargets.ts";

export type MoveOption = { value: string; label: string };

/** A column's name: the workspace's own label wins; a shipped stage (label === id) resolves through
 *  the localized enum catalog. */
export function stageName(id: string, axis: readonly StageDef[], enumLabel: (id: string) => string, retired: readonly StageDef[] = []): string {
  const st = axis.find((s) => s.id === id) ?? retired.find((s) => s.id === id);
  return st && st.label !== st.id ? st.label : enumLabel(id);
}

/** The "Move to" options for one entry, in axis order. An empty current stage ("") lists every target:
 *  the "Move all to..." of a retired column. */
export function moveOptions(currentStage: string, axis: readonly StageDef[], enumLabel: (id: string) => string): MoveOption[] {
  return moveTargetStages(currentStage, axis).map((id) => ({ value: id, label: stageName(id, axis, enumLabel) }));
}

/** Candidates standing on a stage this board no longer draws, grouped by that stage (one group per
 *  retired column: "this is what deleting that column did"). */
export function strandedByStage(entries: readonly Entry[], axis: readonly StageDef[]): Map<string, Entry[]> {
  const on = new Set(axis.map((s) => s.id));
  const out = new Map<string, Entry[]>();
  for (const e of entries) if (!on.has(e.stage)) out.set(e.stage, [...(out.get(e.stage) ?? []), e]);
  return out;
}

/** The role's new arrivals: its ACTIVE candidates on the axis's ENTRY column. A role action that reached
 *  every column would make "Reject all" a way to empty a whole role in one click. `lane` is the role's
 *  lane key (entryLaneKey: job id, else title), so two roles that share a title stay apart. */
export function entryColumnCohort(lane: string, entries: readonly Entry[], axis: readonly StageDef[]): Entry[] {
  const entry = stagesWithRole("entry", axis)[0];
  if (!entry) return [];
  return entries.filter((e) => e.status === "active" && e.stage === entry && entryLaneKey(e) === lane);
}

/** Accept all = move each to the column after the entry column; Reject all = the guarded reject. Both
 *  carry `expectedStage`, so a candidate that moved since the board was read is skipped by the server. */
export function entryBatchItems(cohort: readonly Entry[], action: "acceptAll" | "rejectAll", axis: readonly StageDef[]): PipelineBatchItem[] {
  if (action === "rejectAll") return cohort.map((e) => ({ id: e.id, action: "reject", expectedStage: e.stage }));
  const entry = stagesWithRole("entry", axis)[0];
  const at = axis.findIndex((s) => s.id === entry);
  const next = at >= 0 ? axis[at + 1] : undefined;
  if (!next) return [];
  return cohort.map((e) => ({ id: e.id, action: "set_stage", toStage: next.id, expectedStage: e.stage }));
}
