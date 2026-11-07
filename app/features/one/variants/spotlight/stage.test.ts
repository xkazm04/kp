import { test } from "node:test";
import assert from "node:assert/strict";
import type { PanelInstance } from "../../types";
import { arrangeStage } from "./stage.ts";

const view = (id: string, pinned = false): PanelInstance => ({ id, kind: "decisionsQueue", params: {}, pinned });

test("nothing on screen: no hero, nothing beside, nothing pinned", () => {
  assert.deepEqual(arrangeStage([], null), { hero: null, beside: [], pinned: [] });
});

test("the newest unpinned view is the hero; the rest sit beside it, newest first", () => {
  const a = view("a");
  const b = view("b");
  const c = view("c");
  const plan = arrangeStage([a, b, c], null);
  assert.equal(plan.hero, c);
  assert.deepEqual(plan.beside, [b, a]);
});

test("a view brought forward takes the hero slot", () => {
  const a = view("a");
  const b = view("b");
  const plan = arrangeStage([a, b], "a");
  assert.equal(plan.hero, a);
  assert.deepEqual(plan.beside, [b]);
});

test("pinned views leave the stage for the side, even when focused", () => {
  const a = view("a", true);
  const b = view("b");
  const plan = arrangeStage([a, b], "a");
  assert.equal(plan.hero, b);
  assert.deepEqual(plan.beside, []);
  assert.deepEqual(plan.pinned, [a]);
});

test("only pinned views: the stage is empty, the pins stay on the side", () => {
  const a = view("a", true);
  const plan = arrangeStage([a], null);
  assert.equal(plan.hero, null);
  assert.deepEqual(plan.pinned, [a]);
});
