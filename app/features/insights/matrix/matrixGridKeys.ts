// matrix-grid-arrow-keys — the pure half of the Fit Matrix grid's keyboard model.
//
// Every cell in the grid is a <button>, so every cell was its own tab stop. With the
// candidate pool capped at 200 (`MATRIX_POOL_CAP`) and N open roles, reaching the bottom
// row cost ~1,600 Tab presses — and in select mode the unselectable cells were
// `disabled`, which drops them out of the tab order together with the accessible name
// that says WHY they cannot be selected. The grid now follows the WAI-ARIA grid pattern:
// one tab stop into the table, arrows between cells.
//
// Two decisions worth stating, because both are visible to the reader:
//
//   • ROW -1 IS THE HEADER ROW. The sortable column-header buttons sit in the same
//     roving rectangle as the cells, one per column, aligned with them (the corner /
//     row-header column holds no focusable control, so the rectangle is exactly
//     `cols` wide). Folding them in is what makes the table ONE tab stop instead of
//     1 + N; ArrowUp off the first data row lands on that column's sort control.
//
//   • EDGES CLAMP, THEY DO NOT WRAP. A wrap at row 199 teleports the reader to row 0
//     of a list they cannot see all of, with no cue that it happened; clamping just
//     stops, which is what the scroll position already tells them.
//
// DOM-free and React-free — the hook (`useMatrixGridKeys.ts`) supplies the elements,
// this module supplies the arithmetic, and Node's test runner can load it (no JSX).

/** The header row's index in the roving rectangle. Data rows are 0..rows-1. */
export const MATRIX_HEADER_ROW = -1;

/** Rows PageUp/PageDown travel. A screenful of a 36px cell on a 70vh scroller is
 *  roughly this on a laptop; the exact number matters less than "much more than one,
 *  still countable". */
export const MATRIX_GRID_PAGE = 10;

export type MatrixGridCell = { row: number; col: number };
/** `rows` counts DATA rows only — the header row is always present and is row -1. */
export type MatrixGridSize = { rows: number; cols: number };
export type MatrixGridKeyEvent = { key: string; ctrlKey?: boolean; metaKey?: boolean };

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Fit a cell back inside the grid. Called on every render rather than in an effect, so
 *  a re-sort, a family filter or a min-fit change that shrinks the grid under the roving
 *  cell can never leave `tabIndex={0}` pointing at a cell that no longer exists — the
 *  worst outcome of that is a table with NO tab stop at all. With no data rows (the
 *  frame before `<Defer>` commits the tbody) every row resolves to the header row. */
export function clampMatrixGridCell(cell: MatrixGridCell, size: MatrixGridSize): MatrixGridCell {
  const col = size.cols > 0 ? clamp(cell.col, 0, size.cols - 1) : 0;
  const lastRow = size.rows > 0 ? size.rows - 1 : MATRIX_HEADER_ROW;
  return { row: clamp(cell.row, MATRIX_HEADER_ROW, lastRow), col };
}

/** Where a key press moves the roving cell, or `null` when the grid does not own the
 *  key. `null` is load-bearing: the caller must NOT preventDefault it, so Enter and
 *  Space still reach the native <button> and do exactly what a click does, and Tab
 *  still leaves the grid. */
export function matrixGridKeyMove(
  event: MatrixGridKeyEvent,
  from: MatrixGridCell,
  size: MatrixGridSize,
): MatrixGridCell | null {
  if (size.cols <= 0) return null;
  const corner = event.ctrlKey === true || event.metaKey === true;
  const lastRow = size.rows > 0 ? size.rows - 1 : MATRIX_HEADER_ROW;
  const to = (row: number, col: number) => clampMatrixGridCell({ row, col }, size);

  switch (event.key) {
    case "ArrowUp":
      return to(from.row - 1, from.col);
    case "ArrowDown":
      return to(from.row + 1, from.col);
    case "ArrowLeft":
      return to(from.row, from.col - 1);
    case "ArrowRight":
      return to(from.row, from.col + 1);
    case "PageUp":
      return to(from.row - MATRIX_GRID_PAGE, from.col);
    case "PageDown":
      return to(from.row + MATRIX_GRID_PAGE, from.col);
    case "Home":
      return corner ? to(MATRIX_HEADER_ROW, 0) : to(from.row, 0);
    case "End":
      return corner ? to(lastRow, size.cols - 1) : to(from.row, size.cols - 1);
    default:
      return null;
  }
}

export type MatrixRect = { top: number; left: number; bottom: number; right: number };

/** How far the grid's scroller must move for `cell` to be fully readable.
 *
 *  `scrollIntoView({ block: "nearest", inline: "nearest" })` is not enough here: it
 *  stops as soon as the cell touches the scroll port's edge, and the top and left edges
 *  of this port are covered by the sticky header row and the sticky candidate column. A
 *  cell parked exactly there is focused, ringed — and invisible. `inset` is the size of
 *  the sticky corner header (its height is the header row's, its width the candidate
 *  column's, because a table's cells share their row height and column width), so
 *  `view.top + inset.top` is the first pixel the reader can actually see.
 *
 *  For a cell BIGGER than the open band the top-left edge wins: chasing the bottom edge
 *  would push the cell's own start back under the header. */
export function matrixGridScrollDelta(
  cell: MatrixRect,
  view: MatrixRect,
  inset: { top: number; left: number },
): { dx: number; dy: number } {
  const axis = (near: number, far: number, viewNear: number, viewFar: number, pad: number) => {
    const open = viewNear + pad;
    if (near < open) return near - open;
    if (far > viewFar) return Math.min(far - viewFar, near - open);
    return 0;
  };
  return {
    dx: axis(cell.left, cell.right, view.left, view.right, inset.left),
    dy: axis(cell.top, cell.bottom, view.top, view.bottom, inset.top),
  };
}
