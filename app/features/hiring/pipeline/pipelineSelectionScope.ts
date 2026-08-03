// bulk-acts-on-what-you-see — the two pure pieces that keep the board's bulk actions
// honest about WHICH rows they are about to touch.
//
// The board keeps `selectedIds` across filter changes (that is the deliberate product
// decision: a recruiter who filters down to review a subset has not abandoned the
// rest, and pruning would silently shrink a cohort they built on purpose). The price
// of keeping it is that the selection can contain rows that are no longer on screen —
// so the board owes the recruiter two things, both derived here:
//
//   1. `visibleScopeSignature` — a stable identity for "what the board is showing".
//      An armed destructive confirm is stamped with it (pipelineBulkConfirm.ts) and
//      stops counting as armed the moment it changes. Covers EVERY membership-
//      affecting filter input at once, so no handler has to remember to disarm.
//   2. `selectionOutsideVisible` — the selected rows that the current filter hides,
//      so the bulk bar can state the over-reach plainly instead of a bare
//      "12 selected" that looks like 12 rows on screen.
//
// DB-free and React-free so both are provable in a unit test.

/** The filter inputs that change WHICH entries the board shows. `sort` is deliberately
 *  absent: it reorders the visible set without changing its membership, so re-sorting
 *  must not invalidate an armed confirm. */
export type VisibleScopeShape = {
  query: string;
  quicks: ReadonlySet<string>;
  scoreBands: ReadonlySet<string>;
  sources: ReadonlySet<string>;
  stage: string | null;
};

/** Order-independent, stable string identity of the visible scope. Sets are sorted
 *  before serialization so `{a,b}` and `{b,a}` are the same scope (toggling a chip on
 *  and back off must not count as a change), and the query is trimmed for the same
 *  reason the filter predicate trims it. Field separators are control characters no
 *  filter value can contain, so two different scopes can never collide into one
 *  string. */
export function visibleScopeSignature(shape: VisibleScopeShape): string {
  const set = (s: ReadonlySet<string>) => [...s].sort().join("\u001f") /* unit separator */;
  return [
    shape.query.trim(),
    set(shape.quicks),
    set(shape.scoreBands),
    set(shape.sources),
    shape.stage ?? "",
  ].join("\u001e") /* record separator */;
}

/** The selected ids that the current filter hides — i.e. the rows a bulk action would
 *  touch that the recruiter cannot see. Returned in selection order so a future caller
 *  can name them, not just count them. */
export function selectionOutsideVisible(
  selectedIds: Iterable<string>,
  visibleEntries: readonly { id: string }[]
): string[] {
  const visible = new Set(visibleEntries.map((e) => e.id));
  return [...selectedIds].filter((id) => !visible.has(id));
}
