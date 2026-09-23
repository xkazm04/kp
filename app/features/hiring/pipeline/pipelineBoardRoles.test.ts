// board-grid-has-a-name — the board's lanes ARE a grid (positions down the side,
// stages across the top). On the card board they were once a run of bare divs, so
// a screen reader read a flat list of candidate names with no notion of which
// column any of them stood in. The map board (Subway) inherited the contract:
// this pins the shape rather than a snapshot, naming the element each assertion
// guards, so a refactor that keeps the semantics keeps passing.
//
// A source guard: the roles live in JSX with no pure seam to call. The board is
// split across the host and its subway/ parts, so the guard reads them as one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BOARD_FILES = [
  "PipelineBoardSubway.tsx",
  "subway/SubwayMarks.tsx",
  "subway/SubwayLineRow.tsx",
  "subway/SubwayBeads.tsx",
];
const board = BOARD_FILES.map((f) => readFileSync(`app/features/hiring/pipeline/map/${f}`, "utf8")).join("\n");

test("the lanes are a named grid with a declared row and column count", () => {
  assert.match(board, /role="grid"/, "the lane container must be a grid");
  assert.match(board, /aria-label=\{t\("board\.gridAria"\)\}/, "the grid needs a name, from the catalog");
  assert.match(board, /aria-colcount=\{columns\.length \+ 1\}/, "columns plus the position rail");
  assert.match(board, /aria-rowcount=\{positions\.length \+ 1\}/, "lanes plus the header row");
});

test("both the header row and every lane are rows, with headers at their edges", () => {
  assert.equal((board.match(/role="row"/g) ?? []).length, 2, "exactly two row sites: the header row and the line row");
  assert.equal((board.match(/role="columnheader"/g) ?? []).length, 2, "the position rail label and the station header");
  assert.match(board, /role="rowheader"/, "the line's position cell names its row");
});

test("a cell is a gridcell that says which position, which stage and how many", () => {
  assert.match(board, /role="gridcell"/);
  assert.match(board, /aria-label=\{cellAria\(stageLabel\(stage\), cellEntries\.length\)\}/, "position, stage and the count, all three");
  // The RENDERED label, not the stored id: a workspace that renames a column must
  // hear its own word, the same one the column header shows.
  assert.match(board, /cellAria=\{\(stage, count\) =>\s*t\("board\.cellAria", \{ position: pos\.title, stage, count \}\)/);
});

test("a bead is a real button that names the candidate, never a button inside a button", () => {
  // The station button fills the cell underneath (absolute); beads are its
  // SIBLINGS. Nested buttons are not markup and a screen reader keeps only one.
  assert.match(board, /className="focus-ring absolute inset-0 z-0 cursor-pointer"/, "the station button is the cell's underlay");
  assert.match(board, /aria-label=\{label\}/, "each bead carries an accessible name");
  assert.match(board, /t\("candidateRow\.menuFor", \{ name: e\.candidateLabel \}\)/, "…the same 'Actions for {name}' the card row's menu answered to");
  assert.match(board, /t\("scoreKind\.transferTitle"\)/, "a transfer score is never read as a match score");
});

test("an empty station says so in words, not only by shape", () => {
  // (A drag in flight names a refusing station instead - pipeline-board-ui/B - but an
  // empty cell otherwise still says "No candidates".)
  assert.match(board, /title=\{droppable === false \? move\?\.dropRefused : cellEntries\.length === 0 \? cellEmpty : undefined\}/);
  assert.match(board, /cellEmpty=\{t\("board\.cellEmpty"\)\}/);
  // …and it is INERT: nobody stands there, so there is nothing to expand or select.
  // The cell names itself; the station button - the Orchard door, or in select mode
  // the cell checkbox - exists only when occupied.
  assert.match(board, /aria-label=\{empty \? cellAria\(stageLabel\(stage\), 0\) : undefined\}/);
  assert.match(board, /\{empty \? null : selectMode && interaction\.onSelectCell \? \(\s*(\/\/[^\n]*\n\s*)*<button/, "no station button on an empty cell");
  assert.doesNotMatch(board, /\{empty \? \(?\s*<button/, "an empty cell never renders a button of either kind");
});
