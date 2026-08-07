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

/** A sentinel `currentStage` that matches NO stage on the canonical axis, so
 *  `moveTargetStages` applies only its UNCONDITIONAL exclusion. Not a stage name and
 *  never rendered — it exists so the bulk list can reuse the one definition of the
 *  Hired rule instead of restating it. */
const NO_CURRENT_STAGE = "\u0000no-current-stage";

/** The stage options for the board's BULK "Move to" control (retire-erroring-bulk-
 *  control). The bulk bar built its list from the raw canonical axis, so it offered
 *  "Hired" — which the set_stage route unconditionally 422s — and applying it yielded
 *  N failures with everything still selected: exactly the "dead control that always
 *  errors" `moveTargetStages` exists to prevent, and which drag, the row menu and the
 *  drawer already route through.
 *
 *  A bulk selection has NO single current stage, so only the unconditional exclusion
 *  can apply: Hired is dropped, every other canonical stage is offered. Per-row
 *  current-stage exclusion is deliberately NOT attempted — a mixed selection has no
 *  one answer, and `bulkMove` already treats an already-at-target card as moved with
 *  no round trip, so offering a stage some of the selection already sits in is
 *  harmless where offering Hired is not. Derived from `moveTargetStages` so the Hired
 *  rule has exactly one definition; order follows PIPELINE_STAGES. */
export function bulkMoveTargetStages(): string[] {
  return moveTargetStages(NO_CURRENT_STAGE);
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
