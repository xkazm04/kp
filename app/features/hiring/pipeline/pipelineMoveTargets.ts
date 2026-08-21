// The board's keyboard/menu "Move to…" affordance — the accessible twin of the
// pointer drag-and-drop across stage columns (WCAG 2.1.1). Kept pure and DB-free
// so the "which stages can a card at X move to" contract is unit-testable in
// isolation and shared by CandidateRow's move menu without re-hardcoding stage
// literals that could drift from the canonical axis.
import { DEFAULT_STAGE_AXIS, stageWithRole, type StageDef } from "@/app/_lib/pipeline-stages";

/** The stages a candidate currently at `currentStage` may be moved TO from the
 *  board menu — the canonical stage axis MINUS:
 *    - `currentStage` itself (moving a card to the column it already sits in is a
 *      no-op the board's move handler ignores), and
 *    - the TERMINAL stage, which the set_stage route rejects with a 422 (it is
 *      reached only when a candidate ACCEPTS an offer, never by a manual move).
 *      Offering it would be a dead control that always errors, so the keyboard
 *      twin omits it — mirroring the server guard and the drawer's SLA-editor
 *      filter.
 *
 *  The exclusion reads the terminal ROLE rather than the literal "Hired": a
 *  workspace that renames its final column must not suddenly be offered a move
 *  that always 422s. On the default axis this resolves to "Hired", unchanged.
 *
 *  Order follows the axis so the menu reads down the funnel. An unknown / legacy
 *  `currentStage` (not on the axis) simply yields every non-terminal stage —
 *  which is exactly what the off-axis strip needs to offer a stranded candidate
 *  somewhere real to go.
 *
 *  `axis` defaults to the shipped board so every existing call site (and the
 *  drawer, and the bulk bar) keeps working; the board passes the workspace's. */
export function moveTargetStages(currentStage: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string[] {
  const terminal = stageWithRole("terminal", axis);
  return axis.map((s) => s.id).filter((s) => s !== currentStage && s !== terminal);
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
export function bulkMoveTargetStages(axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string[] {
  return moveTargetStages(NO_CURRENT_STAGE, axis);
}

/** The full option list for the drawer's "Move to stage" <Select> (bug-ui
 *  pipeline #2). The control's `value` is the candidate's CURRENT stage, so that
 *  stage must remain a selectable option (it renders as "… (current)"); every
 *  OTHER option must be a stage a manual set_stage move can actually succeed into
 *  — i.e. `moveTargetStages`, which drops the terminal stage (the route
 *  unconditionally 422s a manual move to it). Offering it was a dead control that
 *  always errored, so it is excluded UNLESS the candidate already sits there (then
 *  it is the current stage and stays, so the Select still has a valid selected row).
 *  Kept in canonical funnel order so the menu reads down the funnel.
 *
 *  An OFF-AXIS current stage is carried too, FIRST, because the axis-order filter
 *  below cannot keep it: a stage this board does not draw has no position on the
 *  funnel. That used to be unreachable — a legacy stage was remapped by
 *  migratePipelineStages() on boot — but an EDITABLE axis re-creates it every time a
 *  workspace retires a column, and the drawer genuinely opens on those candidates
 *  (boardVisibleOrder appends the off-axis strip to the prev/next cohort on purpose).
 *  Dropped, the <Select> has no option matching its own `value` and renders its
 *  PLACEHOLDER — so the one control that says where the candidate stands showed
 *  "Select…" instead of the stage they are stranded on. Selecting it back is a no-op
 *  the drawer's moveStage already short-circuits, so it costs nothing to keep. */
export function moveStageSelectValues(currentStage: string, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): string[] {
  const targets = new Set(moveTargetStages(currentStage, axis));
  const values = axis.map((s) => s.id).filter((s) => s === currentStage || targets.has(s));
  const onAxis = axis.some((s) => s.id === currentStage);
  // An empty/absent stage is not a place a candidate can stand — never mint a blank row.
  return onAxis || !currentStage ? values : [currentStage, ...values];
}
