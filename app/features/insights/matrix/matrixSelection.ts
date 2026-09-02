// matrix-shortlist-acts-on-what-you-see — the pure pieces that keep the Fit Matrix's
// bulk shortlist honest about WHICH cells "Add 5" is about to file.
//
// The grid keeps `selected` across every change to what is on screen: the role-family
// filter, the min-fit floor, and the `?job=` scope. That is deliberate and it matches
// the board's decision in round 23 (28463f8f, "keep bulk actions on the rows you can
// actually see"): a recruiter who filters down to review a subset has not abandoned the
// rest, and a silently shrunk cohort just swaps over-reach for under-reach. The price of
// keeping the selection is that it can contain cells that are no longer visible — so the
// select bar owes the recruiter that number BEFORE the click, which is what
// `selectionOutsideVisible` derives.
//
// The other two exports exist so that number is derived from the SAME code the grid
// renders from, not from a re-implementation of it:
//   • `visibleMatrixColumns` is the column filter itself, lifted out of useMatrixTab's
//     memo (the hook now calls it), so a test can drive the real family/`?job=` rule.
//   • `visibleMatrixCellKeys` crosses the visible rows (already produced by the pure,
//     tested `orderMatrixRows`) with those columns.
//
// DB-free and React-free so all three are provable in a unit test.

/** The grid's cell identity: candidate id + position id. Single-sourced here because
 *  `toggleCell`, `addSelected`, `MatrixGrid`'s `added`/`selected` lookups and the
 *  visibility diff below must all spell it the same way. */
export function matrixCellKey(candId: string, posId: string): string {
  return `${candId}|${posId}`;
}

/** The columns the grid actually renders, with each position's ORIGINAL index preserved
 *  so callers can index back into `cells`. A `?job=` scope wins over the family filter
 *  (arriving from a Pipeline position means "rank for this one role"), and a scope whose
 *  position no longer exists yields no columns — the stale-link case the tab detects. */
export function visibleMatrixColumns<P extends { id: string; roleFamily: string }>(
  positions: readonly P[],
  opts: { family: string; jobParam: string | null },
): { p: P; i: number }[] {
  const indexed = positions.map((p, i) => ({ p, i }));
  if (opts.jobParam) return indexed.filter(({ p }) => p.id === opts.jobParam);
  return indexed.filter(({ p }) => opts.family === "all" || p.roleFamily === opts.family);
}

/** Every cell key currently on screen = visible rows × visible columns. Rows come from
 *  `orderMatrixRows` (which has already applied the min-fit floor), columns from
 *  `visibleMatrixColumns`, so all three ways the view can shrink are covered at once. */
export function visibleMatrixCellKeys(
  rows: readonly { cand: { id: string } }[],
  cols: readonly { p: { id: string } }[],
): Set<string> {
  const keys = new Set<string>();
  for (const { cand } of rows) {
    for (const { p } of cols) keys.add(matrixCellKey(cand.id, p.id));
  }
  return keys;
}

/** The selected cells the current view hides — i.e. the candidates "Add N" would file
 *  that the recruiter cannot see. Returned in selection order (a Set iterates in
 *  insertion order) so a future caller can name them, not just count them.
 *
 *  Deliberately a DISCLOSURE input, never a prune: nothing here removes a key from the
 *  selection, and `addSelected` still files the full set. Mirrors the board's pinned
 *  decision — see the header. */
export function selectionOutsideVisible(
  selected: Iterable<string>,
  visibleKeys: ReadonlySet<string>,
): string[] {
  return [...selected].filter((k) => !visibleKeys.has(k));
}
