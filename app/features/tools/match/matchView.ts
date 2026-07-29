// Which branch the Match tab's result area renders — and, crucially, whether a
// transient re-rank/re-weight failure WIPES the ranking or rides on top of it.
//
// Invariant: a prior ranking always wins over an error. A failed re-rank (timeout
// / 500 / network blip) must keep the last good <Results> on screen and surface
// the error as a NON-destructive inline banner — never collapse the whole panel to
// a single red line (job-ui-scan finding #2: the render gate was `error ? … :
// result ? …`, so error was checked first and destroyed a perfectly good ranking).
// Only when there is no prior result does an error take the full panel.
//
// Extracted as a pure function (no React) so the ordering is unit-tested directly
// against the exact regression it prevents: error-first gating.

export type MatchViewInput = {
  hasResult: boolean;
  error: string | null;
  loading: boolean;
};

export type MatchView =
  | { kind: "results"; inlineError: string | null }
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { kind: "empty" };

export function selectMatchView({ hasResult, error, loading }: MatchViewInput): MatchView {
  // Prior ranking present → keep it mounted; any error becomes an inline banner.
  if (hasResult) return { kind: "results", inlineError: error };
  // No ranking to protect → an error owns the panel.
  if (error) return { kind: "error", message: error };
  if (loading) return { kind: "loading" };
  return { kind: "empty" };
}
