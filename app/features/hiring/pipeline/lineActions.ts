// The row context menu's cohort and its batch items — pure, so the "which candidates
// does Accept all / Reject all / AI evaluate touch" rule is unit-tested.
//
// The cohort is the position's ACTIVE candidates on the axis's ENTRY column: the
// CVs that arrived and nobody has looked at. A row menu that reached every column
// would make "Reject all" a way to empty a whole role in one click.

import { stagesWithRole, type StageDef } from "@/app/_lib/pipeline-stages";
import type { PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import { entryLaneKey, type Entry, type Position } from "@/app/features/shared/pipelineTypes";

export function entryColumnCohort(position: Position, entries: readonly Entry[], axis: readonly StageDef[]): Entry[] {
  const entry = stagesWithRole("entry", axis)[0];
  if (!entry) return [];
  return entries.filter((e) => e.status === "active" && e.stage === entry && entryLaneKey(e) === position.id);
}

/** Accept all = move each one to the column after the entry column; Reject all =
 *  the guarded reject. Both carry `expectedStage`, so a candidate that moved since
 *  the board was read is skipped by the server rather than acted on blindly. */
export function lineBatchItems(cohort: readonly Entry[], action: "acceptAll" | "rejectAll", axis: readonly StageDef[]): PipelineBatchItem[] {
  const entry = stagesWithRole("entry", axis)[0];
  const at = axis.findIndex((s) => s.id === entry);
  const next = at >= 0 ? axis[at + 1] : undefined;
  if (action === "rejectAll") return cohort.map((e) => ({ id: e.id, action: "reject", expectedStage: e.stage }));
  if (!next) return [];
  return cohort.map((e) => ({ id: e.id, action: "set_stage", toStage: next.id, expectedStage: e.stage }));
}
