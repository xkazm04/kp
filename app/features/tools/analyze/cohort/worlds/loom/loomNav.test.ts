import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOM_ROOT, cursorKey, layerKey, loomReduce, moveCursor, parseCursorKey, stepDimension, topOf, type LoomEntry } from "./loomNav.ts";

const skills: LoomEntry = { level: 1, dimension: "skills", focus: "a" };

test("pulling a row pushes L1; pulling the same row again returns to it; Esc pops to the loom", () => {
  const one = loomReduce(LOOM_ROOT, { type: "push", entry: skills });
  assert.equal(one.length, 2);
  assert.deepEqual(topOf(one), skills);
  const again = loomReduce(one, { type: "push", entry: { level: 1, dimension: "skills", focus: null } });
  assert.equal(again.length, 2, "the same row is a place already on the stack");
  assert.deepEqual(loomReduce(one, { type: "pop" }), LOOM_ROOT);
  assert.deepEqual(loomReduce(LOOM_ROOT, { type: "pop" }), LOOM_ROOT, "the loom never leaves");
});

test("a sideways step replaces the pulled row and keeps the layer", () => {
  const one = loomReduce(LOOM_ROOT, { type: "push", entry: skills });
  const side = loomReduce(one, { type: "replaceTop", entry: { level: 1, dimension: "trust", focus: "a" } });
  assert.equal(side.length, 2);
  assert.equal((topOf(side) as Extract<LoomEntry, { level: 1 }>).dimension, "trust");
  assert.equal(layerKey(topOf(one), 1), layerKey(topOf(side), 1));
});

test("rows step and wrap in the contract's order", () => {
  assert.equal(stepDimension("fit", 1), "skills");
  assert.equal(stepDimension("fit", -1), "publicWork");
  assert.equal(stepDimension("publicWork", 1), "fit");
});

test("the cursor walks the weave without wrapping; the tag row has no spool", () => {
  assert.deepEqual(moveCursor({ row: 0, col: 0 }, "ArrowLeft", 7, 20), { row: 0, col: -1 });
  assert.deepEqual(moveCursor({ row: 0, col: -1 }, "ArrowLeft", 7, 20), { row: 0, col: -1 });
  assert.deepEqual(moveCursor({ row: 0, col: -1 }, "ArrowUp", 7, 20), { row: -1, col: 0 });
  assert.deepEqual(moveCursor({ row: -1, col: 3 }, "ArrowUp", 7, 20), { row: -1, col: 3 });
  assert.deepEqual(moveCursor({ row: 6, col: 3 }, "ArrowDown", 7, 20), { row: 6, col: 3 });
  assert.deepEqual(moveCursor({ row: 2, col: 3 }, "End", 7, 20), { row: 2, col: 19 });
  assert.deepEqual(moveCursor({ row: 2, col: 3 }, "Home", 7, 20), { row: 2, col: -1 });
  assert.deepEqual(moveCursor({ row: -1, col: 3 }, "Home", 7, 20), { row: -1, col: 0 });
  assert.equal(moveCursor({ row: 0, col: 0 }, "g", 7, 20), null, "no bare letters");
});

test("cursor keys round-trip", () => {
  for (const c of [{ row: -1, col: 4 }, { row: 3, col: -1 }, { row: 6, col: 19 }]) assert.deepEqual(parseCursorKey(cursorKey(c)), c);
  assert.equal(parseCursorKey("knot:a:1"), null);
  assert.equal(parseCursorKey(undefined), null);
});
