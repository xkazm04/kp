/*
 * The pure half of a kit select mode (SelectBox.tsx, BulkBar.tsx): how much of what is shown is
 * selected, the "select all shown" toggle, one key's toggle and the over-reach count a bulk bar owes
 * the reader before it acts. Inputs are never mutated (they are React state). Added for the Pipeline
 * parity port (the retired board's bulk select, PIPE1), where the kit had no select mode at all.
 */

export type AllState = "none" | "some" | "all";

/** How much of `shown` is selected. Nothing shown is "none": there is nothing to pick. */
export function allState(selected: ReadonlySet<string>, shown: readonly string[]): AllState {
  if (!shown.length) return "none";
  let n = 0;
  for (const k of shown) if (selected.has(k)) n++;
  return n === 0 ? "none" : n === shown.length ? "all" : "some";
}

/** "Select all shown": a partly or un-selected view selects the rest; a fully selected one clears
 *  what is shown. Keys outside `shown` are never added or removed. */
export function toggleAll(selected: ReadonlySet<string>, shown: readonly string[]): Set<string> {
  const next = new Set(selected);
  const on = allState(selected, shown) !== "all";
  for (const k of shown) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

export function toggleKey(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Selected keys the current view does not show: the bar states this number before any action. */
export function selectedOutside(selected: ReadonlySet<string>, shown: readonly string[]): number {
  const visible = new Set(shown);
  let n = 0;
  for (const k of selected) if (!visible.has(k)) n++;
  return n;
}

/** The checkbox's aria-checked for an AllState. */
export function ariaChecked(state: AllState): boolean | "mixed" {
  return state === "all" ? true : state === "some" ? "mixed" : false;
}
