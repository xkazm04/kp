// The DataTable's windowing maths (kit.js paint): a viewport exactly N rows tall, only the
// visible rows plus a 3-row overscan in the DOM, one translated slice, a pager that reads the
// visible range. Pure, so the arithmetic is pinned here rather than in a browser.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { OVERSCAN, foldedExtras, foldedTracks, rowWindow, scrollToRow, stepKey, trackCount } from "./windowing.ts";

test("at the top: the visible rows plus the overscan below, no slice offset", () => {
  const w = rowWindow(0, 11 * 56, 56, 200);
  assert.deepEqual(w, { start: 0, end: 11 + OVERSCAN, offset: 0, from: 1, to: 11 });
});

test("scrolled: overscan above and below, the slice translated to its first row", () => {
  const w = rowWindow(56 * 50, 56 * 11, 56, 200);
  assert.equal(w.start, 47);
  assert.equal(w.end, 64);
  assert.equal(w.offset, 47 * 56);
  assert.equal(w.from, 51);
  assert.equal(w.to, 61);
  assert.equal(w.end - w.start, 11 + 2 * OVERSCAN, "the DOM holds N + 6 rows, whatever the total");
});

test("at the bottom: the window and the pager clamp to the last row", () => {
  const w = rowWindow(56 * 189, 56 * 11, 56, 200);
  assert.equal(w.end, 200);
  assert.equal(w.to, 200);
});

test("an empty list and an unmeasured row height render nothing", () => {
  assert.deepEqual(rowWindow(0, 600, 56, 0), { start: 0, end: 0, offset: 0, from: 0, to: 0 });
  assert.equal(rowWindow(0, 600, 0, 50).end, 0);
});

test("scrollToRow moves the shortest way, and not at all when the row is in view", () => {
  assert.equal(scrollToRow(5, 0, 560, 56), null);
  assert.equal(scrollToRow(12, 0, 560, 56), 13 * 56 - 560);
  assert.equal(scrollToRow(2, 300, 560, 56), 112);
});

test("stepKey starts an unselected list at its first row and clamps at both ends", () => {
  const keys = ["a", "b", "c"];
  assert.equal(stepKey(keys, null, 1), "a");
  assert.equal(stepKey(keys, null, -1), "a");
  assert.equal(stepKey(keys, "b", 1), "c");
  assert.equal(stepKey(keys, "c", 1), "c");
  assert.equal(stepKey(keys, "a", -1), "a");
  assert.equal(stepKey(keys, "gone", 1), "a", "a selection no longer in the list restarts at the top");
  assert.equal(stepKey([], null, 1), null);
});

test("the collapse order folds every sub-track of a split meta to 0px", () => {
  assert.equal(trackCount("minmax(0,1fr)"), 1);
  assert.equal(trackCount("minmax(0, 1fr) 200px"), 2);
  assert.equal(foldedTracks("minmax(0,1fr) 80px"), "0px 0px");
});

test("fold step 1 keeps a split meta's first track and folds only its extras", () => {
  assert.equal(foldedExtras("minmax(0,1fr) 200px"), "minmax(0,1fr) 0px");
  assert.equal(foldedExtras("minmax(0, 1fr) 80px 120px"), "minmax(0, 1fr) 0px 0px");
  assert.equal(foldedExtras("minmax(0,1fr)"), "minmax(0,1fr)", "an unsplit meta has nothing to fold at step 1");
});
