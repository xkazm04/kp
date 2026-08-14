// The ordering rules of the shared table sort. Pure comparator only — the hook
// around it is a useState/useMemo wrapper with nothing to assert that these
// cases don't already cover.
//
// The rule under test is the one hand-rolled comparators keep getting wrong:
// a MISSING value is not a small value. Analytics rows are full of honest nulls
// (an unpriced LLM call, a role with no hires yet, a channel with no spend
// entered), and `(a ?? 0) - (b ?? 0)` silently turns every one of them into a
// zero — so "sort by cost, highest first" buries real spend under a wall of
// unknowns, and the reader has no way to tell the difference.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCells } from "./useTableSort.ts";

test("missing values sort last in BOTH directions", () => {
  // Ascending: a real value outranks a missing one.
  assert.ok(compareCells(5, null, "asc") < 0);
  assert.ok(compareCells(null, 5, "asc") > 0);
  // Descending: still last — the flip must not float unknowns to the top.
  assert.ok(compareCells(5, null, "desc") < 0);
  assert.ok(compareCells(null, 5, "desc") > 0);
  // Two missing values tie rather than churning the stable order.
  assert.equal(compareCells(null, undefined, "asc"), 0);
  assert.equal(compareCells(undefined, null, "desc"), 0);
});

test("an empty string counts as missing, not as the smallest string", () => {
  // A blank cell is "not recorded", the same fact as null — an empty model name
  // or an unset channel must not sort above every real name in ascending order.
  assert.ok(compareCells("", "Backend Engineer", "asc") > 0);
  assert.ok(compareCells("", "Backend Engineer", "desc") > 0);
});

test("numbers compare numerically, not lexically", () => {
  assert.ok(compareCells(9, 10, "asc") < 0);
  assert.ok(compareCells(9, 10, "desc") > 0);
  // The zero/null distinction the ledger depends on: a real 0 is a value and
  // outranks a missing one, in both directions.
  assert.ok(compareCells(0, null, "asc") < 0);
  assert.ok(compareCells(0, null, "desc") < 0);
});

test("strings compare with numeric collation so Role 2 precedes Role 10", () => {
  assert.ok(compareCells("Role 2", "Role 10", "asc") < 0);
  assert.ok(compareCells("Role 10", "Role 2", "asc") > 0);
});

test("string comparison ignores case so ordering matches how it reads", () => {
  // Codepoint order puts every capital before every lowercase, which reads as a
  // broken alphabetical sort ("Zebra" before "apple").
  assert.ok(compareCells("apple", "Zebra", "asc") < 0);
});

test("booleans order false before true, and flip with direction", () => {
  assert.ok(compareCells(false, true, "asc") < 0);
  assert.ok(compareCells(false, true, "desc") > 0);
});

test("direction inverts the comparison for real values", () => {
  assert.equal(Math.sign(compareCells(1, 2, "asc")), -Math.sign(compareCells(1, 2, "desc")));
  assert.equal(Math.sign(compareCells("a", "b", "asc")), -Math.sign(compareCells("a", "b", "desc")));
});
