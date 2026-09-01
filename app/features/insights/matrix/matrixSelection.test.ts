// matrix-shortlist-acts-on-what-you-see — the defect this file pins, in the recruiter's
// own sequence:
//
//     tick five cells -> switch the role-family filter (or raise the min-fit floor, or
//     arrive scoped by ?job=) -> the bar still says "Add 5" -> press it
//
// Pre-fix, `addSelected` iterated every key in `selected` with no notion of what the grid
// was SHOWING, and nothing reconciled the selection when `setFamily` / `setMinFit` /
// `clearJob` / a `?job=` arrival changed the visible set. Three candidates the recruiter
// could no longer see were filed into roles they were not looking at, and the only number
// on screen — `selected.size` — read as "5 cells on this grid".
//
// The fix mirrors the board's round-23 decision (28463f8f): DISCLOSE, never prune. So
// these cases assert both halves — the count of hidden-but-selected cells is right, AND
// the selection itself is left intact.
//
// NON-VACUITY. Two independent ways this file goes RED against the pre-fix tree:
//   1. `matrixSelection.ts` did not exist -> ERR_MODULE_NOT_FOUND on the import below.
//   2. Beyond existence, the assertions discriminate the fix's actual decisions. A
//      degenerate `selectionOutsideVisible = () => []` (i.e. "nothing is ever hidden",
//      which is exactly the pre-fix belief) type-checks and still FAILS the family,
//      floor and ?job= cases. Verified by mutation, not by assumption.
//
// Runner: Node's built-in test runner with type stripping. `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { orderMatrixRows } from "./matrixRows.ts";
import {
  matrixCellKey,
  selectionOutsideVisible,
  visibleMatrixCellKeys,
  visibleMatrixColumns,
} from "./matrixSelection.ts";

// ---------------------------------------------------------------------------
// Fixture: 4 candidates × 3 positions across 2 role families.
// ---------------------------------------------------------------------------

const CANDIDATES = [
  { id: "c1", label: "Ada" },
  { id: "c2", label: "Bob" },
  { id: "c3", label: "Cyd" },
  { id: "c4", label: "Dee" },
];

const POSITIONS = [
  { id: "p1", title: "Backend", roleFamily: "engineering" },
  { id: "p2", title: "Frontend", roleFamily: "engineering" },
  { id: "p3", title: "Designer", roleFamily: "design" },
];

// cells[rowIndex][colIndex] — null = blocked / unscored, exactly as the grid stores it.
// Dee is blocked on every role, so she is the "unassessed" row the floor drops.
const CELLS: (number | null)[][] = [
  [90, 80, 20], // Ada   — best 90
  [60, 30, 85], // Bob   — best 85
  [40, 45, 30], // Cyd   — best 45
  [null, null, null], // Dee — no assessed cell at all
];

/** The hook's derivation, end to end: the same two calls `useMatrixTab` makes, in the
 *  same order, over the same inputs. This is the production pipeline being exercised —
 *  not a re-implementation of it — which is what makes the counts below meaningful. */
function visibleKeysFor(opts: { family?: string; jobParam?: string | null; minFit?: number }): Set<string> {
  const cols = visibleMatrixColumns(POSITIONS, {
    family: opts.family ?? "all",
    jobParam: opts.jobParam ?? null,
  });
  const colIdx = cols.map((c) => c.i);
  const { order } = orderMatrixRows(
    CANDIDATES.map((cand, ri) => ({
      item: { cand, ri },
      label: cand.label,
      visibleScores: colIdx.map((ci) => CELLS[ri]?.[ci] ?? null),
    })),
    { sortByFit: true, sortByColumn: false, minFit: opts.minFit ?? 0 },
  );
  return visibleMatrixCellKeys(order, cols);
}

const k = matrixCellKey;

// ---------------------------------------------------------------------------
// The four ways the grid's view can diverge from the selection
// ---------------------------------------------------------------------------

test("nothing hidden: the whole selection is on screen", () => {
  const visible = visibleKeysFor({});
  assert.equal(visible.size, 12, "4 candidates × 3 positions are all rendered");
  const selected = new Set([k("c1", "p1"), k("c2", "p3")]);
  assert.deepEqual(selectionOutsideVisible(selected, visible), [], "no disclosure is owed");
});

test("the role-family filter hides some of the selection", () => {
  // Switch to "engineering" AFTER ticking a designer cell: p3's whole column goes away,
  // and with it two ticks the recruiter can no longer see.
  const visible = visibleKeysFor({ family: "engineering" });
  assert.equal(visible.size, 8, "4 candidates × the 2 engineering positions");

  const selected = new Set([k("c1", "p1"), k("c2", "p3"), k("c3", "p3")]);
  assert.deepEqual(
    selectionOutsideVisible(selected, visible),
    [k("c2", "p3"), k("c3", "p3")],
    "both designer ticks are outside the engineering view"
  );
  assert.equal(selected.size, 3, "and the selection is NOT pruned — disclose, never shrink");
});

test("the min-fit floor hides some of the selection", () => {
  // A floor of 70 keeps Ada (best 90) and Bob (best 85); Cyd (best 45) is cut as a weak
  // fit and Dee is cut as unassessed. Both rows keep their ticks.
  const visible = visibleKeysFor({ minFit: 70 });
  assert.equal(visible.size, 6, "2 surviving candidates × 3 positions");

  const selected = new Set([k("c1", "p1"), k("c3", "p1"), k("c4", "p2")]);
  assert.deepEqual(
    selectionOutsideVisible(selected, visible),
    [k("c3", "p1"), k("c4", "p2")],
    "a row cut by the floor takes its ticks off screen but not out of the add"
  );
});

test("a ?job= scope hides all but one column", () => {
  // Arriving from a Pipeline position scopes the grid to that role alone. Every tick on
  // any OTHER role is now invisible — the widest divergence of the three.
  const visible = visibleKeysFor({ jobParam: "p2" });
  assert.equal(visible.size, 4, "4 candidates × the single scoped position");

  const selected = new Set([k("c1", "p1"), k("c1", "p2"), k("c2", "p3")]);
  assert.deepEqual(
    selectionOutsideVisible(selected, visible),
    [k("c1", "p1"), k("c2", "p3")],
    "only the scoped column's tick is on screen"
  );
});

test("the floor is measured over the VISIBLE columns, so the two narrowings compound", () => {
  // Family "design" leaves only p3, and the floor then re-measures each row's best
  // against THAT column alone — so Ada (90 on backend, 20 on design) is cut as well.
  // A cell hidden by both narrowings is still reported once, not twice.
  const visible = visibleKeysFor({ family: "design", minFit: 70 });
  assert.deepEqual([...visible], [k("c2", "p3")], "only Bob clears 70 on the design column");

  const selected = new Set([k("c1", "p1"), k("c1", "p3"), k("c2", "p3"), k("c3", "p3")]);
  assert.deepEqual(selectionOutsideVisible(selected, visible), [k("c1", "p1"), k("c1", "p3"), k("c3", "p3")]);
});

// ---------------------------------------------------------------------------
// The column filter itself
// ---------------------------------------------------------------------------

test("visibleMatrixColumns preserves each position's ORIGINAL index", () => {
  // The index is what `cells[ri][ci]`, `colScores` and `sortCol` are keyed by — a filter
  // that re-indexed would read the wrong column's scores.
  assert.deepEqual(
    visibleMatrixColumns(POSITIONS, { family: "design", jobParam: null }).map((c) => c.i),
    [2]
  );
  assert.deepEqual(
    visibleMatrixColumns(POSITIONS, { family: "all", jobParam: null }).map((c) => c.i),
    [0, 1, 2]
  );
});

test("a ?job= scope wins over the family filter, and a stale one yields no columns", () => {
  assert.deepEqual(
    visibleMatrixColumns(POSITIONS, { family: "engineering", jobParam: "p3" }).map((c) => c.p.id),
    ["p3"],
    "the deep-linked role shows even when the family filter would hide it"
  );
  assert.deepEqual(
    visibleMatrixColumns(POSITIONS, { family: "all", jobParam: "gone" }),
    [],
    "a link that outlived its position scopes to nothing — the staleJob case"
  );
});

// ---------------------------------------------------------------------------
// The key format the add path splits back apart
// ---------------------------------------------------------------------------

test("matrixCellKey round-trips through addSelected's split", () => {
  const [candId, posId] = matrixCellKey("c1", "p2").split("|");
  assert.equal(candId, "c1");
  assert.equal(posId, "p2");
});
