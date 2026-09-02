import test from "node:test";
import assert from "node:assert/strict";
import { POSTING_TAB_IDS, isPostingTabId, nextTabIndex } from "./jobsPostingModalTabs.ts";

// The job modal's seven tabs were a `role="tablist"` in name only: every button
// was a tab stop (no roving tabindex) and the arrow keys did nothing, so reaching
// "Agent fit" from "Posting" cost six Tabs through a strip whose ARIA promises one.
// The movement rule is SegmentedControl's, lifted into a pure function so it can
// be pinned without a DOM.

test("the tab vocabulary is a closed literal set with a runtime guard", () => {
  assert.equal(POSTING_TAB_IDS.length, 7);
  assert.equal(isPostingTabId("agentfit"), true);
  assert.equal(isPostingTabId("Posting"), false);
  assert.equal(isPostingTabId("billing"), false);
});

test("arrow keys move one step and wrap at both ends", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 7), 1);
  assert.equal(nextTabIndex("ArrowDown", 0, 7), 1);
  assert.equal(nextTabIndex("ArrowRight", 6, 7), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 7), 6);
  assert.equal(nextTabIndex("ArrowUp", 3, 7), 2);
});

test("Home and End jump to the ends", () => {
  assert.equal(nextTabIndex("Home", 4, 7), 0);
  assert.equal(nextTabIndex("End", 0, 7), 6);
});

test("any other key is not ours — null, so the event keeps its default", () => {
  for (const key of ["Enter", " ", "Tab", "Escape", "a"]) assert.equal(nextTabIndex(key, 2, 7), null);
});

test("an empty strip never produces an index to focus", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});
