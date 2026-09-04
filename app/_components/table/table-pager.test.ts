// The pager arithmetic seven surfaces depend on, and which nothing tested.
//
// `clampPage` + `pageSlice` are the whole reason a filter can shrink a table
// under a reader who is on page 3 without an effect that resets the page — the
// clamp is derived state. That contract is load-bearing for the Channels
// ledger, both receiver tables, the Activity ledger, the Archetypes roster, the
// Assignments outbox and the Tasks window, and until now the only thing
// checking it was that the screens looked right in the cases anyone opened.
//
// The cases below are the ones the callers actually hit: an empty result set (a
// filter matched nothing), a set that shrank past the current page, a page
// boundary, and the last partial page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPage, pageCount, pageSlice, TABLE_PAGE_SIZE } from "./pageWindow.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

test("an empty table is page 1 of 1, not page 1 of 0", () => {
  // A pager reading "page 1 of 0" is the shape every off-by-one here produces,
  // and it is what a filter matching nothing would show.
  assert.equal(pageCount(0), 1);
  assert.equal(clampPage(0, 0), 0);
  // …including from a page the reader was already on when the filter landed.
  assert.equal(clampPage(7, 0), 0);
  assert.deepEqual(pageSlice(rows(0), 0), []);
});

test("pageCount counts the last partial page", () => {
  assert.equal(pageCount(TABLE_PAGE_SIZE), 1, "exactly one full page is one page");
  assert.equal(pageCount(TABLE_PAGE_SIZE + 1), 2, "one row over is a second page");
  assert.equal(pageCount(47, 20), 3);
  assert.equal(pageCount(1), 1);
});

test("clampPage lands a reader on a page that exists after a filter shrinks the set", () => {
  // THE case this function exists for: on page 3 of 9, a filter cuts the set to
  // 25 rows (2 pages). Resetting to 0 would throw away the reader's position;
  // clamping keeps them at the end of what is left.
  assert.equal(clampPage(2, 25, 20), 1);
  // Already valid pages are untouched.
  assert.equal(clampPage(0, 25, 20), 0);
  assert.equal(clampPage(1, 25, 20), 1);
  // A negative page (a Previous click at the start, before the button disables)
  // never escapes downward.
  assert.equal(clampPage(-3, 100, 20), 0);
});

test("pageSlice returns the window the clamped page names", () => {
  const all = rows(47);
  assert.deepEqual(pageSlice(all, 0, 20), all.slice(0, 20));
  assert.deepEqual(pageSlice(all, 1, 20), all.slice(20, 40));
  // The last page is short, not padded — 41..47 is seven rows.
  assert.equal(pageSlice(all, 2, 20).length, 7);
  // Past the end is empty rather than throwing; the clamp is what keeps a caller
  // out of here, and a slice that threw would take the table down with it.
  assert.deepEqual(pageSlice(all, 9, 20), []);
});

test("clamp and slice agree: the clamped page is never an empty window", () => {
  // The invariant every caller relies on, over every size a filter can produce.
  for (let total = 0; total <= 45; total++) {
    const all = rows(total);
    for (const requested of [0, 1, 2, 5, 40]) {
      const page = clampPage(requested, total, 20);
      const shown = pageSlice(all, page, 20);
      if (total === 0) assert.equal(shown.length, 0);
      else assert.ok(shown.length > 0, `total=${total} page=${page} produced an empty window`);
      assert.ok(page >= 0 && page < pageCount(total, 20));
    }
  }
});

test("the shared page size is the one every table uses", () => {
  // Named rather than inlined so paging feels identical across surfaces; the
  // default parameter on all three helpers is this constant, not a repeated 20.
  assert.equal(TABLE_PAGE_SIZE, 20);
  assert.equal(pageCount(41), pageCount(41, TABLE_PAGE_SIZE));
  assert.deepEqual(pageSlice(rows(41), 2), pageSlice(rows(41), 2, TABLE_PAGE_SIZE));
});
