// Two-step confirms for the two DESTRUCTIVE bulk actions on the pipeline board's
// select-mode bar:
//   • reject   — emails N candidates (irreversible)
//   • outreach — WHEN a relay is configured, dispatchOutreach relays each drafted
//                letter immediately, so "draft N" IS "send N"
// Both arm a confirm rather than fire on the first click.
//   • move     — (challenge-r06 blast-radius-computation) when its dry-run preview
//                says the move sets something off: AI interview invites, work-sample
//                assignments, erased pending decisions, drafted offers kept back
//                (pipelineBulkMovePreview.ts). Its cohort signature also signs the
//                target column, so re-pointing "Move to" re-previews.
//
// This module exists to close a round-5 defect: the two confirms were two separate
// boolean flags, and every selection mutation reset ONLY the reject flag. So a
// recruiter could arm the outreach confirm, GROW the selection, and the next click
// would draft to the expanded cohort without re-confirming. Modelling BOTH confirms
// as ONE piece of state with a pure reducer makes "disarm on any selection change"
// a single, un-forgettable transition — the two can never drift apart again.
//
// bulk-acts-on-what-you-see closes the SECOND half of the same hole. Disarming on a
// selection change was never sufficient: the recruiter can leave the selection alone
// and change what is VISIBLE instead (a quick chip, a score band, a source facet, a
// funnel stage, the search box, Clear filters, a saved view, the degraded-cohort
// focus). The armed confirm then survived the very change that made its cohort
// invisible, and the next click emailed people the recruiter could no longer see.
//
// The fix is deliberately NOT "dispatch a disarm from each of those handlers" — that
// is the same forgettable per-call-site discipline the round-5 defect was made of,
// and the Director's own evidence list of filter mutators was already missing three
// of them (setQueryAndSync, showStage, clearStageFilter). Instead an armed confirm
// CARRIES the visible scope it was armed under, and `armedConfirm` only reports it as
// armed while that scope still holds. A confirm cannot outlive its cohort because
// nothing has to remember to kill it — a new filter mutator added tomorrow is covered
// for free.
//
// Invariants encoded here:
//   • At most ONE confirm is armed at a time (arming one disarms the other).
//   • ANY selection mutation disarms whichever is armed.
//   • ANY change to the visible scope de-arms it by derivation (`armedConfirm`).
//   • An explicit cancel, or firing the action, disarms.
//   • ANY drift in the people the confirm NAMED de-arms it by derivation too.
//
// cohort-drift-forces-a-fresh-review (challenge-r06). The scope stamp still let a
// confirm fire on people it never named: the 30s poll keeps running in select mode, so
// a reject armed over 2 awaiting candidates fired on however many were awaiting at the
// click, and a named candidate whose stage or pending decision moved was rejected under
// a confirm that described someone else's situation. An armed confirm now also carries
// the SIGNATURE of the actionable cohort it was armed over (id + stage + decision kind,
// `cohortSignature` in pipelineBulkSelection.ts), and `armedConfirm` reports it armed
// only while the current cohort signs identically. A confirm may only ever apply to
// the rows the reviewer saw.

/** An armed confirm, together with the visible-board scope signature it was armed
 *  under (see `visibleScopeSignature` in pipelineSelectionScope.ts) and the signature
 *  of the cohort it names (`cohortSignature`, pipelineBulkSelection.ts). null = none. */
export type BulkConfirm = { which: "reject" | "outreach" | "move"; scope: string; cohort: string } | null;

/** What a CHILD component dispatches. It knows which confirm it wants armed; it does
 *  NOT know (and must not have to know) the board's current visible scope — the hook
 *  stamps that on. Keeping the child-facing vocabulary scope-free is what stops a new
 *  bulk control from accidentally arming an unscoped confirm. */
export type BulkConfirmIntent =
  /** Arm a specific confirm (disarms the other). */
  | { type: "arm"; which: "reject" | "outreach" | "move" }
  /** The user explicitly backed out of the armed confirm. */
  | { type: "cancel" }
  /** ANY change to the selection (toggle, select-all, clear, a bulk action that
   *  mutates the selection). A confirm armed for cohort A must never survive into
   *  cohort B. */
  | { type: "selectionChanged" }
  /** The confirmed action was dispatched — the confirm has served its purpose. */
  | { type: "fired" };

/** The reducer's event union: a child `BulkConfirmIntent` with the board's current
 *  visible scope AND the signature of the cohort on screen stamped onto `arm`. */
export type BulkConfirmEvent =
  | { type: "arm"; which: "reject" | "outreach" | "move"; scope: string; cohort: string }
  | Exclude<BulkConfirmIntent, { type: "arm" }>;

/** Pure transition for the board's bulk-confirm state. Total over the event union;
 *  every event except `arm` collapses to `null`, which is exactly the disarm-on-
 *  mutation guarantee the defect was missing. */
export function bulkConfirmReducer(state: BulkConfirm, ev: BulkConfirmEvent): BulkConfirm {
  switch (ev.type) {
    case "arm":
      // Single-slot state: arming one disarms the other, and the scope in force at
      // arm time is captured so the confirm can be invalidated by a filter change.
      return { which: ev.which, scope: ev.scope, cohort: ev.cohort };
    case "cancel":
    case "selectionChanged":
    case "fired":
      return null;
  }
}

/** Which confirm is ACTUALLY armed right now, given the board's current visible
 *  scope. A confirm armed under scope A is not armed under scope B — so the click
 *  that follows a filter/facet/saved-view change RE-ARMS instead of firing, and the
 *  recruiter re-confirms against the cohort they can now see.
 *
 *  The same holds for the PEOPLE: `currentCohort` is the signature of the cohort the
 *  armed action would touch NOW; a poll that adds, drops or re-stages anyone in it
 *  makes the next click re-arm (naming the new count) instead of firing.
 *
 *  This is a derivation, not an effect, on purpose: there is no ordering hazard, no
 *  handler that can forget to dispatch, and no window in which the stale confirm is
 *  briefly still live. Read this — never `state.which` — anywhere the UI decides
 *  whether the next click fires a destructive bulk action. */
export function armedConfirm(
  state: BulkConfirm,
  currentScope: string,
  currentCohort: string
): "reject" | "outreach" | "move" | null {
  return state && state.scope === currentScope && state.cohort === currentCohort ? state.which : null;
}
