import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampMatrixGridCell,
  matrixGridKeyMove,
  matrixGridScrollDelta,
  MATRIX_GRID_PAGE,
  MATRIX_HEADER_ROW,
} from "./matrixGridKeys.ts";

// matrix-grid-arrow-keys — the Fit Matrix grid's keyboard model. Every cell used to be
// its own tab stop: 200 candidates x N roles is ~1,600 Tab presses to reach the bottom
// row. These are the two pure pieces the roving-tabindex hook is built from — where a
// key lands, and how far the scroller must move so the landing cell is not hiding under
// a sticky header.

const size = { rows: 5, cols: 3 };
const press = (key: string, extra: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({ key, ...extra });

test("arrows step one cell in each direction", () => {
  assert.deepEqual(matrixGridKeyMove(press("ArrowDown"), { row: 1, col: 1 }, size), { row: 2, col: 1 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowUp"), { row: 1, col: 1 }, size), { row: 0, col: 1 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowRight"), { row: 1, col: 1 }, size), { row: 1, col: 2 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowLeft"), { row: 1, col: 1 }, size), { row: 1, col: 0 });
});

test("the sortable column headers are row -1: ArrowUp off the first data row reaches them", () => {
  // The header row is part of the roving rectangle, which is what makes the whole table
  // ONE tab stop — the per-column sort buttons are not N extra ones.
  assert.deepEqual(matrixGridKeyMove(press("ArrowUp"), { row: 0, col: 2 }, size), { row: MATRIX_HEADER_ROW, col: 2 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowDown"), { row: MATRIX_HEADER_ROW, col: 2 }, size), { row: 0, col: 2 });
});

test("edges CLAMP, never wrap — an arrow at the border stays put", () => {
  // Stated choice: clamping. Wrapping in a 200-row grid teleports the reader to the
  // opposite end of a list they cannot see, and there is no visual cue that it happened.
  assert.deepEqual(matrixGridKeyMove(press("ArrowUp"), { row: MATRIX_HEADER_ROW, col: 0 }, size), { row: MATRIX_HEADER_ROW, col: 0 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowDown"), { row: 4, col: 0 }, size), { row: 4, col: 0 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowLeft"), { row: 2, col: 0 }, size), { row: 2, col: 0 });
  assert.deepEqual(matrixGridKeyMove(press("ArrowRight"), { row: 2, col: 2 }, size), { row: 2, col: 2 });
});

test("Home/End run to the ends of the CURRENT row", () => {
  assert.deepEqual(matrixGridKeyMove(press("Home"), { row: 3, col: 1 }, size), { row: 3, col: 0 });
  assert.deepEqual(matrixGridKeyMove(press("End"), { row: 3, col: 1 }, size), { row: 3, col: 2 });
});

test("Ctrl/Cmd+Home and Ctrl/Cmd+End run to the grid corners", () => {
  assert.deepEqual(matrixGridKeyMove(press("Home", { ctrlKey: true }), { row: 3, col: 1 }, size), { row: MATRIX_HEADER_ROW, col: 0 });
  assert.deepEqual(matrixGridKeyMove(press("End", { ctrlKey: true }), { row: 0, col: 0 }, size), { row: 4, col: 2 });
  // macOS sends metaKey for the same intent.
  assert.deepEqual(matrixGridKeyMove(press("End", { metaKey: true }), { row: 0, col: 0 }, size), { row: 4, col: 2 });
});

test("PageUp/PageDown jump a page of rows and clamp at both ends", () => {
  const tall = { rows: 200, cols: 3 };
  assert.deepEqual(matrixGridKeyMove(press("PageDown"), { row: 0, col: 1 }, tall), { row: MATRIX_GRID_PAGE, col: 1 });
  assert.deepEqual(matrixGridKeyMove(press("PageUp"), { row: 3, col: 1 }, tall), { row: MATRIX_HEADER_ROW, col: 1 });
  assert.deepEqual(matrixGridKeyMove(press("PageDown"), { row: 199, col: 1 }, tall), { row: 199, col: 1 });
});

test("keys the grid does not own return null so the caller never preventDefaults them", () => {
  // Enter and Space MUST reach the native <button>: activation has to do exactly what a
  // click does (open the popover / toggle selection), including handing openCell a real
  // currentTarget to anchor on. Tab must stay Tab so the one tab stop still lets go.
  for (const key of ["Enter", " ", "Tab", "Escape", "a"]) {
    assert.equal(matrixGridKeyMove(press(key), { row: 1, col: 1 }, size), null, `${key} must not be captured`);
  }
});

test("an empty grid captures nothing", () => {
  assert.equal(matrixGridKeyMove(press("ArrowDown"), { row: MATRIX_HEADER_ROW, col: 0 }, { rows: 0, cols: 0 }), null);
});

test("a body-less grid (Defer's first frame) still moves within the header row", () => {
  // <Defer strategy="next-frame"> commits the tbody one frame late, so the initial
  // roving cell must be a header button and must not be clamped into a row that is
  // not in the DOM yet.
  const noBody = { rows: 0, cols: 4 };
  assert.deepEqual(matrixGridKeyMove(press("ArrowDown"), { row: MATRIX_HEADER_ROW, col: 1 }, noBody), { row: MATRIX_HEADER_ROW, col: 1 });
  assert.deepEqual(matrixGridKeyMove(press("End"), { row: MATRIX_HEADER_ROW, col: 1 }, noBody), { row: MATRIX_HEADER_ROW, col: 3 });
});

test("clamp survives a re-sort/filter that shrinks the grid under the roving cell", () => {
  assert.deepEqual(clampMatrixGridCell({ row: 180, col: 7 }, { rows: 4, cols: 2 }), { row: 3, col: 1 });
  assert.deepEqual(clampMatrixGridCell({ row: 2, col: 1 }, { rows: 0, cols: 2 }), { row: MATRIX_HEADER_ROW, col: 1 });
  assert.deepEqual(clampMatrixGridCell({ row: -9, col: -3 }, size), { row: MATRIX_HEADER_ROW, col: 0 });
});

// --- scrolling clear of the sticky headers -----------------------------------------

const view = { top: 100, left: 200, bottom: 500, right: 800 };
const inset = { top: 60, left: 140 }; // the sticky corner th: header-row height x row-header width

test("a cell hidden UNDER the sticky header row scrolls up by exactly the overlap", () => {
  // scrollIntoView({block:"nearest"}) alone stops at the scroller's edge — i.e. under
  // the header. The inset is what makes the cell actually readable.
  const cell = { top: 130, left: 400, bottom: 166, right: 484 };
  assert.deepEqual(matrixGridScrollDelta(cell, view, inset), { dx: 0, dy: 130 - 160 });
});

test("a cell hidden BEHIND the sticky row-header column scrolls left by the overlap", () => {
  const cell = { top: 200, left: 300, bottom: 236, right: 384 };
  assert.deepEqual(matrixGridScrollDelta(cell, view, inset), { dx: 300 - 340, dy: 0 });
});

test("a cell past the bottom/right edges scrolls just far enough to show it", () => {
  const cell = { top: 480, left: 760, bottom: 516, right: 844 };
  assert.deepEqual(matrixGridScrollDelta(cell, view, inset), { dx: 844 - 800, dy: 516 - 500 });
});

test("a fully visible cell does not move the scroller", () => {
  const cell = { top: 300, left: 400, bottom: 336, right: 484 };
  assert.deepEqual(matrixGridScrollDelta(cell, view, inset), { dx: 0, dy: 0 });
});

test("a cell taller/wider than the open band exposes its TOP-LEFT, never its bottom", () => {
  // Chasing the bottom edge would shove the cell's own start back under the header —
  // the reader would be looking at the tail of a cell whose label is off-screen.
  const cell = { top: 150, left: 320, bottom: 900, right: 1200 };
  const d = matrixGridScrollDelta(cell, view, inset);
  assert.deepEqual(d, { dx: 320 - 340, dy: 150 - 160 });
});

test("the header row is measured with no top inset — it IS the sticky layer", () => {
  const headerCell = { top: 105, left: 300, bottom: 155, right: 384 };
  assert.deepEqual(matrixGridScrollDelta(headerCell, view, { top: 0, left: inset.left }), { dx: 300 - 340, dy: 0 });
});
