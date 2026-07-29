// Two-step confirms for the two DESTRUCTIVE bulk actions on the pipeline board's
// select-mode bar:
//   • reject   — emails N candidates (irreversible)
//   • outreach — WHEN a relay is configured, dispatchOutreach relays each drafted
//                letter immediately, so "draft N" IS "send N"
// Both arm a confirm rather than fire on the first click.
//
// This module exists to close a round-5 defect: the two confirms were two separate
// boolean flags, and every selection mutation reset ONLY the reject flag. So a
// recruiter could arm the outreach confirm, GROW the selection, and the next click
// would draft to the expanded cohort without re-confirming. Modelling BOTH confirms
// as ONE piece of state with a pure reducer makes "disarm on any selection change"
// a single, un-forgettable transition — the two can never drift apart again.
//
// Invariants encoded here:
//   • At most ONE confirm is armed at a time (arming one disarms the other).
//   • ANY selection mutation disarms whichever is armed (the fix).
//   • An explicit cancel, or firing the action, disarms.

/** Which destructive bulk action currently has its confirm armed (null = none). */
export type BulkConfirm = "reject" | "outreach" | null;

export type BulkConfirmEvent =
  /** Arm a specific confirm (disarms the other). */
  | { type: "arm"; which: "reject" | "outreach" }
  /** The user explicitly backed out of the armed confirm. */
  | { type: "cancel" }
  /** ANY change to the selection (toggle, select-all, clear, a bulk action that
   *  mutates the selection). A confirm armed for cohort A must never survive into
   *  cohort B. */
  | { type: "selectionChanged" }
  /** The confirmed action was dispatched — the confirm has served its purpose. */
  | { type: "fired" };

/** Pure transition for the board's bulk-confirm state. Total over the event union;
 *  every event except `arm` collapses to `null`, which is exactly the disarm-on-
 *  mutation guarantee the defect was missing. */
export function bulkConfirmReducer(state: BulkConfirm, ev: BulkConfirmEvent): BulkConfirm {
  switch (ev.type) {
    case "arm":
      return ev.which; // arming one disarms the other (single-slot state)
    case "cancel":
    case "selectionChanged":
    case "fired":
      return null;
  }
}
