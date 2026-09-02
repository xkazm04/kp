// Two pure decisions the Fit Matrix tab used to make inline, in JSX, untested.
//
// Both are the kind of logic that reads as obvious and is not: `deriveMatrixMode`
// carries the override-expiry rule that makes a SECOND "View full match" work after
// the reader has toggled back to the grid, and `pickGridState` is a six-way branch
// whose ORDER is the contract (an error must win over stale, stale over empty), sat
// as a chain of nested ternaries nobody could assert against.
//
// Kept JSX-free so the node --test runner can load them.

/** Grid = the pool-first heatmap; focus = one candidate, every role ranked. */
export type MatrixMode = "grid" | "focus";

/** A manual mode choice, STAMPED with the focus param it was made against. The stamp
 *  is the expiry: a later ?profile= arrival carries a different param, so the override
 *  stops applying by itself instead of needing an effect to clear it (which would set
 *  state during render and cascade an extra pass). */
export type MatrixModeOverride = { mode: MatrixMode; forParam: string | null };

/** The URL is the source of truth for the mode — ?profile= / ?analysis= reach this tab
 *  from the roster, the pipeline drawer, the command palette and a cell's own "View full
 *  match" — and a manual toggle only wins while the param it was stamped against still
 *  holds. */
export function deriveMatrixMode(focusParam: string | null, override: MatrixModeOverride | null): MatrixMode {
  if (override && override.forParam === focusParam) return override.mode;
  return focusParam ? "focus" : "grid";
}

/** What the grid half should render. Ordered by precedence, not by likelihood. */
export type MatrixGridState =
  /** The fetch failed; the reader gets the localized code + a retry. */
  | "error"
  /** First load in flight — nothing to show yet. */
  | "loading"
  /** A ?job= deep-link whose position no longer exists. */
  | "stale"
  /** The pool itself is empty (no candidates, or no open positions). */
  | "empty"
  /** There IS data, but the min-fit floor / family filter hid every row or column. */
  | "filtered"
  /** The grid. */
  | "grid";

export function pickGridState(input: {
  hasError: boolean;
  hasData: boolean;
  staleJob: boolean;
  candidateCount: number;
  positionCount: number;
  rowCount: number;
  colCount: number;
}): MatrixGridState {
  if (input.hasError) return "error";
  if (!input.hasData) return "loading";
  if (input.staleJob) return "stale";
  if (input.candidateCount === 0 || input.positionCount === 0) return "empty";
  if (input.rowCount === 0 || input.colCount === 0) return "filtered";
  return "grid";
}
