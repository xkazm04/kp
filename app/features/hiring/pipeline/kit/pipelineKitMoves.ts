/*
 * The pipeline's stage-move vocabulary, pure: a column's display name, the legal "Move to" targets
 * (never the entry's own stage, never the terminal ROLE: a renamed "Placed" refuses exactly like
 * "Hired"), and who stands on a column the workspace removed. Used by Off the board and the Orbit.
 * Recovered from the retired Subway board and kept when the kit roles board was retired (2026-09-28);
 * its role-cohort batch (Accept all / Reject all) went with the roles board.
 */
import type { StageDef } from "../../../../_lib/pipeline-stages.ts";
import type { Entry } from "../../../shared/pipelineTypes.ts";
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
