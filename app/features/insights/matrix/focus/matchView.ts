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

// ---------------------------------------------------------------------------
// THE RANKED FIELD — how many roles the list shows vs how many actually SURVIVED
// the knockout filter.
//
// useMatchTabRun posts `limit: 25` and the Python matcher returns `scored[:limit]`,
// reporting both numbers in meta: `survivors` (roles that cleared every KO gate and
// were scored) and `returned` (the slice that came back). The header only ever
// rendered `returned`, labelled "Ranked" — so a real run (a senior CZ/EN engineer
// against the 120-role corpus: evaluated 120, koFiltered 46, survivors 74) printed
// "Evaluated 120 · KO-filtered 46 · Ranked 25". The arithmetic doesn't close, the 49
// scored roles the cap dropped are invisible, and the CSV export carries the same
// truncated 25 out of the app as if it were the candidate's whole field.
//
// The GRID half of this tab already solves exactly this (MatrixDataNotices renders
// poolCap/poolTotal as "N of M"); this is its candidate-focus counterpart. `total`
// is non-null ONLY when the payload proves a cut, so an older response without
// `survivors` — or a run where nothing was dropped — keeps claiming nothing extra.
export type RankedField = { shown: number; total: number | null };

export function rankedField(
  meta: { survivors?: number; returned?: number },
  matchesLength: number,
): RankedField {
  const shown =
    typeof meta.returned === "number" && Number.isFinite(meta.returned) ? meta.returned : matchesLength;
  const survivors = meta.survivors;
  const cut = typeof survivors === "number" && Number.isFinite(survivors) && survivors > shown;
  return { shown, total: cut ? survivors : null };
}

// ---------------------------------------------------------------------------
// THE CANDIDATE PICKER'S PLACEHOLDER — which of the three mutually-exclusive
// reasons an option list is empty.
//
// The in-flight case was already split out from the empty one ("Loading…" instead
// of "No saved profiles"). The FAILED case was not: a 500 from /api/profile or
// /api/analyses resolved to a body with no rows, so a workspace with 40 saved
// profiles rendered "No saved profiles (build one in Profile)" — an empty state
// asserting a cause it cannot know — and the source segment silently flipped to
// "Saved analysis" as if the account really were empty.
export type OptionsPlaceholder = "loading" | "failed" | "empty" | null;

export function candidateOptionsPlaceholder({
  loaded,
  failed,
  count,
}: {
  loaded: boolean;
  failed: boolean;
  count: number;
}): OptionsPlaceholder {
  if (!loaded) return "loading";
  // Rows on hand always win: a partial/stale list is still a real list to pick from.
  if (count > 0) return null;
  return failed ? "failed" : "empty";
}
