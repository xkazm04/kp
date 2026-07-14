// Direction 3 (select-hygiene) — the pure rules behind the batch selection's
// integrity, extracted from DecisionsTab so they're unit-testable (a .tsx can't be
// loaded by the node test runner) and can't silently regress:
//
//   - pruneSelection: drop selected ids whose cards have vanished (a committed/
//     moved card leaves the cohort; its id must not leak in the Set forever).
//   - selectionDrift: after "select all", cards that ARRIVE mid-selection are not
//     selected — surface how many, so select-all isn't silently stale.
//   - capNames: group a wave's comms-failure names with a "+N more" cap so the
//     banner can't grow unbounded across committed waves.

/** Intersect `selected` with the ids currently present. Returns the SAME Set
 *  reference when nothing was pruned, so a `setState(prev => pruneSelection(...))`
 *  is a no-op (React bails on identity) and never churns a render on a clean poll. */
export function pruneSelection(selected: ReadonlySet<string>, presentIds: Iterable<string>): Set<string> {
  const present = presentIds instanceof Set ? presentIds : new Set(presentIds);
  let removed = false;
  for (const id of selected) {
    if (!present.has(id)) {
      removed = true;
      break;
    }
  }
  if (!removed) return selected as Set<string>;
  const next = new Set<string>();
  for (const id of selected) if (present.has(id)) next.add(id);
  return next;
}

/** The ids present now that were NOT in the set captured at "select all" time —
 *  i.e. cards that arrived since. `snapshot` null (select-all not used, or reset)
 *  → no drift. Order follows `currentSelectableIds` so a caller can name them. */
export function selectionDriftIds(snapshot: readonly string[] | null, currentSelectableIds: readonly string[]): string[] {
  if (!snapshot) return [];
  const seen = new Set(snapshot);
  return currentSelectableIds.filter((id) => !seen.has(id));
}

/** Split `labels` into the first `cap` to show plus the overflow count. A
 *  non-positive cap shows none (all overflow); anonymous ("") labels are dropped
 *  first so a "+N more" never counts a blank. */
export function capNames(labels: readonly string[], cap: number): { shown: string[]; more: number } {
  const named = labels.filter((l) => l.trim().length > 0);
  if (cap <= 0) return { shown: [], more: named.length };
  return { shown: named.slice(0, cap), more: Math.max(0, named.length - cap) };
}
