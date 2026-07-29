// The board's keyboard/menu "Move to…" affordance — the accessible twin of the
// pointer drag-and-drop across stage columns (WCAG 2.1.1). Kept pure and DB-free
// so the "which stages can a card at X move to" contract is unit-testable in
// isolation and shared by CandidateRow's move menu without re-hardcoding stage
// literals that could drift from the canonical axis.
import { PIPELINE_STAGES } from "@/app/_lib/pipeline-stages";

/** The stages a candidate currently at `currentStage` may be moved TO from the
 *  board menu — the canonical stage axis MINUS:
 *    - `currentStage` itself (moving a card to the column it already sits in is a
 *      no-op the board's move handler ignores), and
 *    - "Hired", which the set_stage route rejects with a 422 (Hired is reached
 *      only when a candidate ACCEPTS an offer, never by a manual move). Offering
 *      it would be a dead control that always errors, so the keyboard twin omits
 *      it — mirroring the server guard and the drawer's SLA-editor filter.
 *
 *  Order follows PIPELINE_STAGES so the menu reads down the funnel. An unknown /
 *  legacy `currentStage` (not on the axis) simply yields every non-Hired stage. */
export function moveTargetStages(currentStage: string): string[] {
  return (PIPELINE_STAGES as readonly string[]).filter((s) => s !== currentStage && s !== "Hired");
}

/** The full option list for the drawer's "Move to stage" <Select> (bug-ui
 *  pipeline #2). The control's `value` is the candidate's CURRENT stage, so that
 *  stage must remain a selectable option (it renders as "… (current)"); every
 *  OTHER option must be a stage a manual set_stage move can actually succeed into
 *  — i.e. `moveTargetStages`, which drops "Hired" (the route unconditionally 422s
 *  a manual move to Hired). Offering "Hired" was a dead control that always
 *  errored, so it is excluded UNLESS the candidate already sits at Hired (then it
 *  is the current stage and stays, so the Select still has a valid selected row).
 *  Kept in canonical funnel order so the menu reads down the funnel. */
export function moveStageSelectValues(currentStage: string): string[] {
  const targets = new Set(moveTargetStages(currentStage));
  return (PIPELINE_STAGES as readonly string[]).filter((s) => s === currentStage || targets.has(s));
}
