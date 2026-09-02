"use client";

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  clampMatrixGridCell,
  matrixGridKeyMove,
  matrixGridScrollDelta,
  MATRIX_HEADER_ROW,
  type MatrixGridCell,
  type MatrixGridSize,
} from "./matrixGridKeys";

// matrix-grid-arrow-keys — the DOM half of the grid's keyboard model; the arithmetic
// lives in `matrixGridKeys.ts` (pure, unit-tested, JSX-free).
//
// Roving tabindex, per the WAI-ARIA grid pattern: exactly one control in the table
// carries `tabIndex={0}`, everything else is -1, and the arrows move both focus and that
// single tab stop. The rectangle covers the sortable column headers (row -1) as well as
// the cells, so the whole table costs ONE Tab to enter and one to leave.
//
// Cells are addressed by a `data-mcell="row:col"` attribute rather than a ref map. A ref
// callback re-created per render would detach and re-attach ~1,600 refs on every
// keystroke; a query against the scroller costs one lookup per MOVE, and it stays
// correct across a re-sort without anything having to invalidate a map.
export function useMatrixGridKeys(size: MatrixGridSize) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The sticky corner <th>: its height is the header row's, its width the candidate
  // column's — i.e. exactly the two edges a focused cell can hide under.
  const cornerRef = useRef<HTMLTableCellElement | null>(null);
  // Start on a header button: `<Defer strategy="next-frame">` commits the tbody a frame
  // late, so a data row is not a safe initial target.
  const [focused, setFocused] = useState<MatrixGridCell>({ row: MATRIX_HEADER_ROW, col: 0 });

  // Clamped at READ time, never in an effect: rows and columns come and go with the
  // family filter, the min-fit floor and the column sort, and the tab stop must not
  // follow one of them out of the DOM (a grid with no tabIndex={0} is unreachable).
  const roving = clampMatrixGridCell(focused, size);

  const reveal = useCallback((el: HTMLElement, row: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof el.getBoundingClientRect !== "function") return;
    const corner = cornerRef.current;
    const { dx, dy } = matrixGridScrollDelta(el.getBoundingClientRect(), scroller.getBoundingClientRect(), {
      // The header row is the sticky layer, so nothing covers it vertically.
      top: row === MATRIX_HEADER_ROW ? 0 : corner?.offsetHeight ?? 0,
      left: corner?.offsetWidth ?? 0,
    });
    if (dx !== 0) scroller.scrollLeft += dx;
    if (dy !== 0) scroller.scrollTop += dy;
  }, []);

  const moveTo = useCallback(
    (next: MatrixGridCell) => {
      setFocused(next);
      const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-mcell="${next.row}:${next.col}"]`);
      if (!el) return; // the tbody has not committed yet — the tab stop still moved
      // Our own scrolling, not the browser's: its default would stop with the cell
      // tucked under the sticky header.
      el.focus({ preventScroll: true });
      reveal(el, next.row);
    },
    [reveal],
  );

  /** Spread onto the focusable control of cell (row, col) — a body cell button, or a
   *  column-header sort button at `MATRIX_HEADER_ROW`. */
  const cellProps = (row: number, col: number) => ({
    "data-mcell": `${row}:${col}`,
    tabIndex: row === roving.row && col === roving.col ? 0 : -1,
    // Keeps the tab stop under the cell the reader actually reached — including via a
    // mouse click, and via the reasoning popover's focus restore on close.
    onFocus: () => setFocused((cur) => (cur.row === row && cur.col === col ? cur : { row, col })),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const next = matrixGridKeyMove(event, { row, col }, size);
      if (!next) return; // Enter/Space/Tab stay native — activation must equal a click
      event.preventDefault();
      moveTo(next);
    },
  });

  return { scrollerRef, cornerRef, cellProps };
}
