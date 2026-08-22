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
import { compareCells, initialDir } from "./useTableSort.ts";

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

test("strings collate in the READER's locale, not the runtime's", () => {
  // Czech treats š/č/ř/ž as their own letters, sorted after their base letter.
  // Under the runtime default (en-US on a Node server, whatever the OS says in a
  // browser) the diacritic folds away and the order flips — so a Czech recruiter
  // sorting a roster A–Z saw "Švec" jump above "Sýkora". Both orders were also
  // rendered in the same session: SSR resolves the default to the SERVER's locale
  // and hydration re-sorts with the browser's.
  assert.ok(compareCells("Švec", "Sýkora", "asc", "cs") > 0, "cs: Sýkora precedes Švec");
  assert.ok(compareCells("Čapek", "Cyril", "asc", "cs") > 0, "cs: Cyril precedes Čapek");
  // …and the same two names order the other way for a German or English reader,
  // which is the point of threading the locale rather than picking one.
  assert.ok(compareCells("Švec", "Sýkora", "asc", "en") < 0, "en: Švec folds to Svec and precedes Sýkora");
  assert.ok(compareCells("Čapek", "Cyril", "asc", "de") < 0, "de: Čapek folds to Capek and precedes Cyril");
  // Direction still inverts, and missing values are still pinned last, per locale.
  assert.ok(compareCells("Švec", "Sýkora", "desc", "cs") < 0);
  assert.ok(compareCells(null, "Sýkora", "desc", "cs") > 0);
  // The numeric-collation rule survives the collator swap.
  assert.ok(compareCells("Role 2", "Role 10", "asc", "cs") < 0);
});

test("a new column's start direction samples the first row that HAS a value", () => {
  // The Economics board's honest nulls (a channel with no spend entered) cluster
  // at the top of the unsorted feed. Reading only row 0 saw `null`, decided "not
  // a number", and opened Spend ASCENDING — cheapest first, on the one column the
  // reader clicks to find the biggest number.
  const rows = [{ spend: null }, { spend: null }, { spend: 4200 }];
  assert.equal(initialDir(rows, (r) => r.spend), "desc");
  // A blank string is missing too, not a tiny string.
  assert.equal(initialDir([{ name: "" }, { name: "Backend" }], (r) => r.name), "asc");
  // Text columns still open A–Z, and an all-missing (or empty) column has nothing
  // to read as numeric, so it opens ascending rather than guessing.
  assert.equal(initialDir([{ name: "Backend" }, { name: null }], (r) => r.name), "asc");
  assert.equal(initialDir([{ spend: null }], (r) => r.spend), "asc");
  assert.equal(initialDir([] as { spend: number | null }[], (r) => r.spend), "asc");
});
