import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex } from "./groupEvalTabKeys.ts";

// group-eval-tabs-and-legacy-tell-the-same-truth (a): the per-candidate tablist
// carried the ROLES but none of the APG keyboard contract, so a keyboard user had
// to Tab through every tab (and every button behind it) of an eight-candidate
// field. The movement rule is pinned here as a pure reducer — the component only
// applies what this returns.

test("arrows move one tab and wrap at both ends", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("ArrowLeft", 2, 3), 1);
  // A horizontal tablist still answers the vertical arrows, per APG.
  assert.equal(nextTabIndex("ArrowDown", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowUp", 0, 3), 2);
});

test("Home/End jump to the ends", () => {
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
});

test("keys that are not ours return null so the event keeps its default", () => {
  // Tab must still leave the strip and Escape must still reach the dialog — the
  // component only calls preventDefault() when this is non-null.
  for (const key of ["Tab", "Escape", "Enter", " ", "a", "PageDown"]) {
    assert.equal(nextTabIndex(key, 1, 3), null, key);
  }
});

test("an empty strip has nowhere to move", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  assert.equal(nextTabIndex("Home", 0, 0), null);
});

test("a single tab always resolves to itself, never out of range", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 1), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 1), 0);
  assert.equal(nextTabIndex("End", 0, 1), 0);
});
