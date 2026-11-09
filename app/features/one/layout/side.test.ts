import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryOf, sideOf, tabsOf } from "./side.ts";

const view = (id: string, pinned = false) => ({
  id,
  kind: "needs" as const,
  params: {},
  pinned,
});

test("nothing on screen → no primary, no tabs", () => {
  assert.equal(primaryOf([], null), null);
  assert.deepEqual(tabsOf([], null), []);
  assert.equal(sideOf([], null), null);
});

test("the view in front is the primary", () => {
  assert.equal(primaryOf([view("p1"), view("p2")], "p1")?.id, "p1");
});

test("no front → the newest unpinned, else the newest", () => {
  assert.equal(primaryOf([view("p1"), view("p2", true)], null)?.id, "p1");
  assert.equal(primaryOf([view("p1", true), view("p2", true)], null)?.id, "p2");
  assert.equal(primaryOf([view("p1")], "gone")?.id, "p1");
});

test("tabs: primary first, then pinned, then the rest in screen order", () => {
  const panels = [view("p1"), view("p2", true), view("p3")];
  assert.deepEqual(
    tabsOf(panels, panels[2]).map((p) => p.id),
    ["p3", "p2", "p1"],
  );
});

test("a picked tab holds while on screen; a vanished pick falls back to the primary", () => {
  const tabs = [view("p3"), view("p2", true)];
  assert.equal(sideOf(tabs, "p2")?.id, "p2");
  assert.equal(sideOf(tabs, "p9")?.id, "p3");
  assert.equal(sideOf(tabs, null)?.id, "p3");
});
