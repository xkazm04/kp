// board-grid-has-a-name — the board's lanes ARE a grid (positions down the side,
// stages across the top) and were a run of bare divs, so a screen reader read a flat
// list of candidate names with no notion of which column any of them stood in. Every
// drag already had a keyboard twin and every move was narrated; the structure the
// twins move THROUGH was the part with no name.
//
// A source guard: the roles live in JSX with no pure seam to call, and what has to
// stay true is structural. It pins the shape rather than a snapshot — each assertion
// names the element it guards, so a refactor that keeps the semantics keeps passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync("app/features/hiring/pipeline/PipelineBoard.tsx", "utf8");
const cell = readFileSync("app/features/hiring/pipeline/PipelineBoardStageCell.tsx", "utf8");
const toolbar = readFileSync("app/features/hiring/pipeline/PipelineBoardToolbar.tsx", "utf8");
const scroll = readFileSync("app/features/hiring/pipeline/usePipelineBoardScroll.ts", "utf8");

test("the lanes are a named grid with a declared row and column count", () => {
  assert.match(board, /role="grid"/, "the lane container must be a grid");
  assert.match(board, /aria-label=\{t\("board\.gridAria"\)\}/, "the grid needs a name, from the catalog");
  assert.match(board, /aria-colcount=\{columns\.length \+ 1\}/, "columns plus the position rail");
  assert.match(board, /aria-rowcount=\{positions\.length \+ 1\}/, "lanes plus the header row");
});

test("both the header row and every lane are rows, with headers at their edges", () => {
  assert.equal((board.match(/role="row"/g) ?? []).length, 2, "exactly two row sites: the header row and the lane row");
  assert.equal((board.match(/role="columnheader"/g) ?? []).length, 2, "the position rail label and the stage header button");
  assert.match(board, /role="rowheader"/, "the lane's position cell names its row");
});

test("a cell is a gridcell that says which position, which stage and how many", () => {
  assert.match(cell, /role="gridcell"/);
  assert.match(
    cell,
    /aria-label=\{t\("board\.cellAria", \{ position: laneLabel, stage: stageLabel, count: entries\.length \}\)\}/,
    "position, stage and the count, all three"
  );
  // The RENDERED label, not the stored id: a workspace that renames a column must
  // hear its own word, the same one the column header shows.
  assert.match(board, /stageLabel=\{stageColumnLabel\(axis\[i\]\)\}/);
});

test("a drop target is described, once, and only while dragging is possible", () => {
  assert.match(board, /id=\{dropHintId\} className="sr-only"/, "one shared sr-only description");
  assert.match(board, /\{t\("board\.dropHint"\)\}/);
  assert.match(board, /dropHintId=\{dragEnabled \? dropHintId : undefined\}/, "not a drop target in select mode");
  assert.match(cell, /aria-describedby=\{dropHintId\}/);
});

test("an empty cell reads as empty; the dot is decoration", () => {
  assert.match(cell, /<span aria-hidden className="px-1 text-sm text-stone-300">/, "the middle dot is decorative");
  assert.match(cell, /<span className="sr-only">\{t\("board\.cellEmpty"\)\}<\/span>/);
});

test("the paging arrows disable at the scroll extremes instead of swallowing the click", () => {
  assert.match(toolbar, /disabled=\{!canScrollLeft\}/);
  assert.match(toolbar, /disabled=\{!canScrollRight\}/);
  assert.match(scroll, /setCanScrollLeft\(el\.scrollLeft > 1\)/, "1px of slack, or a smooth scroll flickers them");
  assert.match(scroll, /setCanScrollRight\(el\.scrollLeft < max - 1\)/);
  // The board's width changes without a scroll (viewport resize, a column added or
  // removed from the workspace axis), so the extents are re-measured on both.
  assert.match(scroll, /new ResizeObserver\(syncExtents\)/);
});
