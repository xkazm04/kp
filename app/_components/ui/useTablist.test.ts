// The tablist movement rule, pinned once for every strip that uses it.
//
// Replaces the two byte-identical copies of these assertions that lived beside
// the two copies of the arithmetic (groupEval/groupEvalTabKeys.test.ts and
// library/jobs/jobsPostingModalTabs.test.ts).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex } from "./useTablist.ts";

test("arrows move one step and wrap at both ends", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("ArrowLeft", 2, 3), 1);
});

test("vertical arrows are aliases of the horizontal pair", () => {
  assert.equal(nextTabIndex("ArrowDown", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowUp", 0, 3), 2);
});

test("Home and End jump to the ends", () => {
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
});

test("keys that are not ours return null so the default survives", () => {
  // Tab must still leave the strip, Escape must still reach the dialog, and
  // Enter/Space must still activate the focused tab.
  for (const key of ["Enter", " ", "Tab", "Escape", "a", "PageDown"]) {
    assert.equal(nextTabIndex(key, 1, 3), null, key);
  }
});

test("an empty strip has nowhere to move", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  assert.equal(nextTabIndex("Home", 0, 0), null);
  assert.equal(nextTabIndex("End", 0, 0), null);
});

test("a single tab is its own neighbour in every direction", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 1), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 1), 0);
  assert.equal(nextTabIndex("End", 0, 1), 0);
});

test("an out-of-range origin still lands inside the strip", () => {
  // The strips clamp before calling, but the reducer must not return an index
  // the caller cannot address if a tab disappears mid-keypress.
  for (const origin of [-1, 5, 99]) {
    const next = nextTabIndex("ArrowRight", origin, 3);
    assert.ok(next !== null && next >= 0 && next < 3, `origin ${origin} -> ${next}`);
  }
});
