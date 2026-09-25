/*
 * The DataTable's windowing maths (kit.js paint()): a viewport exactly `visibleRows` rows tall,
 * only the rows in view plus a 3-row overscan exist in the DOM, as ONE translated slice. The
 * pager under the last row reads the visible range and the live DOM count from here.
 */
export const OVERSCAN = 3;

export type RowWindow = {
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  /** translateY of the slice, px. */
  offset: number;
  /** 1-based first and last row the reader can see, for the pager. */
  from: number;
  to: number;
};

export function rowWindow(scrollTop: number, viewportHeight: number, rowHeight: number, total: number): RowWindow {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, offset: 0, from: 0, to: 0 };
  const top = Math.max(0, scrollTop);
  const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
  const end = Math.min(total, Math.ceil((top + viewportHeight) / rowHeight) + OVERSCAN);
  const visible = Math.max(1, Math.round(viewportHeight / rowHeight));
  const from = Math.min(total, Math.floor(top / rowHeight) + 1);
  const to = Math.min(total, from + visible - 1);
  return { start, end, offset: start * rowHeight, from, to };
}

/** The scrollTop that brings row `index` fully into view, or null when it already is. */
export function scrollToRow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number | null {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + viewportHeight) return top + rowHeight - viewportHeight;
  return null;
}

/** Step a selection through `keys` by ±1, clamped; an unselected list starts at the first row. */
export function stepKey(keys: readonly string[], current: string | null, delta: number): string | null {
  if (!keys.length) return null;
  const i = current == null ? -1 : keys.indexOf(current);
  const j = Math.max(0, Math.min(keys.length - 1, i < 0 ? 0 : i + delta));
  return keys[j];
}

/** How many tracks a `meta` subdivision declares ("minmax(0,1fr) 200px" = 2), so the collapse
 *  order can fold every one of them to 0px (kit.js trackCount / tableStyle). */
export function trackCount(template: string): number {
  let depth = 0;
  let count = 1;
  for (const ch of template.trim()) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === " " && depth === 0) count++;
  }
  return count;
}

export function foldedTracks(template: string): string {
  return Array.from({ length: trackCount(template) }, () => "0px").join(" ");
}
