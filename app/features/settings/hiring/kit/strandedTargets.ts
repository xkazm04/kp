import type { StageDef } from "@/app/_lib/pipeline-stages";

/** The stages the stranded picker offers as a destination: the draft axis MINUS its
 *  terminal column. The terminal stage is outcome-bearing (reached by an accepted
 *  offer, never by a move), and the stage-migration door refuses it with 422
 *  PIPELINE_TERMINAL_NOT_MANUAL — offering it would be a dead control. Resolved by
 *  ROLE so a renamed terminal column is dropped too. */
export function strandedTargetStages<S extends Pick<StageDef, "role">>(stages: readonly S[]): S[] {
  return stages.filter((s) => s.role !== "terminal");
}
