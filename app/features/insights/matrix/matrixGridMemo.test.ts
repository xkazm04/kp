// grid-stays-still-while-you-scroll. A source guard over the memo boundaries.
//
// The cost this direction removes cannot be measured from a pure function: it is React
// re-renders of a 200 × N table, and this repo's unit runner has no renderer. So the
// numbers come from `matrixAnchor.test.ts` (40 scroll events → 1 anchor run, versus 40
// before) and the STRUCTURE that turns that into zero grid renders is pinned here.
//
// Each assertion names the specific way the win is silently lost again — a memo whose
// props are re-created every render, or a listener that goes back to setState — because
// every one of those is invisible in review and invisible at runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const row = readFileSync(new URL("./MatrixGridRow.tsx", import.meta.url), "utf8");
const grid = readFileSync(new URL("./MatrixGrid.tsx", import.meta.url), "utf8");
const tab = readFileSync(new URL("./useMatrixTab.ts", import.meta.url), "utf8");
const keys = readFileSync(new URL("./useMatrixGridKeys.ts", import.meta.url), "utf8");

test("the candidate row is an actual memo boundary", () => {
  assert.match(row, /export const MatrixGridRow = memo\(MatrixGridRowInner\)/, "the row must be memoized");
  assert.match(grid, /<MatrixGridRow/, "and the grid must render THAT, not an inline <tr>");
});

test("the row compares per-row signatures, never the shared selection/added Sets", () => {
  // A Set is a new object on every toggle: passing it would re-render all 200 rows when
  // one cell changed, which is the memo doing nothing at a cost.
  assert.match(row, /selSig: string;/, "selection reaches the row as a string");
  assert.match(row, /addSig: string;/, "so does the added ledger");
  assert.ok(!/selected: Set/.test(row) && !/added: Set/.test(row), "no Set may cross the memo boundary");
  assert.match(grid, /selSig=\{selSigs\[r\] \?\? ""\}/, "the grid builds the signatures");
  assert.match(grid, /const \{ selSigs, addSigs \} = useMemo\(/, "in one memoized pass, not per row per render");
});

test("each row gets its OWN roving column, so arrowing re-renders two rows not all of them", () => {
  assert.match(row, /rovingCol: number \| null;/);
  assert.match(grid, /rovingCol=\{roving\.row === r \? roving\.col : null\}/);
});

test("every function crossing the memo boundary is a stable identity", () => {
  // If any of these reverts to a bare arrow the memo becomes a silent no-op: the props
  // differ on every render and React re-renders the row anyway.
  for (const name of ["blockedLabel", "fetchReasoning", "openCell", "toggleCell"]) {
    assert.match(tab, new RegExp(`const ${name} = useCallback\\(`), `${name} must be a useCallback`);
  }
  assert.match(keys, /const cellProps = useCallback\(/, "cellProps is spread onto every cell");
  assert.match(keys, /\[moveTo, rows, cols\]/, "…and depends on size's primitives, not the {rows, cols} literal");
});

test("the scroll/resize anchor never touches React state", () => {
  assert.match(tab, /const anchor = createFrameThrottle\(/, "coalesced to one run per frame");
  assert.match(tab, /node\.style\.top = /, "the frame writes the popover element directly");
  assert.match(tab, /anchor\.cancel\(\);/, "and the pending frame is released on teardown");
  // The regression that costs the most: one setState per scroll event, re-rendering the
  // whole grid for a change only the popover can see.
  const reposition = tab.slice(tab.indexOf("const measure = ()"), tab.indexOf("window.addEventListener(\"keydown\""));
  assert.ok(!/setPopover/.test(reposition), "re-anchoring must not call setPopover");
});
