// Direction 3 (select-hygiene) — unit coverage for the pure selection rules.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneSelection, selectionDriftIds, capNames } from "./selection-hygiene.ts";

test("pruneSelection drops ids whose cards vanished", () => {
  const out = pruneSelection(new Set(["a", "b", "c"]), ["a", "c"]);
  assert.deepEqual([...out].sort(), ["a", "c"]);
});

test("pruneSelection returns the SAME reference when nothing was pruned (no render churn)", () => {
  const sel = new Set(["a", "b"]);
  assert.equal(pruneSelection(sel, ["a", "b", "c"]), sel, "superset of present → identity");
  assert.equal(pruneSelection(sel, new Set(["a", "b"])), sel, "exact present set → identity");
});

test("pruneSelection of an empty selection is a no-op identity", () => {
  const empty = new Set<string>();
  assert.equal(pruneSelection(empty, ["a"]), empty);
});

test("selectionDriftIds names only cards that arrived since select-all", () => {
  assert.deepEqual(selectionDriftIds(["a", "b"], ["a", "b", "c", "d"]), ["c", "d"]);
  assert.deepEqual(selectionDriftIds(["a", "b"], ["a", "b"]), [], "no new cards → no drift");
  assert.deepEqual(selectionDriftIds(["a", "b"], ["a"]), [], "a card leaving is pruning, not drift");
});

test("selectionDriftIds with a null snapshot (select-all not used) is never drift", () => {
  assert.deepEqual(selectionDriftIds(null, ["a", "b"]), []);
});

test("capNames caps the shown names and counts the overflow", () => {
  assert.deepEqual(capNames(["a", "b", "c", "d"], 2), { shown: ["a", "b"], more: 2 });
  assert.deepEqual(capNames(["a", "b"], 5), { shown: ["a", "b"], more: 0 });
});

test("capNames drops anonymous labels before counting overflow", () => {
  assert.deepEqual(capNames(["a", "", "  ", "b", "c"], 2), { shown: ["a", "b"], more: 1 });
  assert.deepEqual(capNames(["", ""], 3), { shown: [], more: 0 }, "all-anonymous → nothing to name");
});

test("capNames with a non-positive cap shows none and counts all named as overflow", () => {
  assert.deepEqual(capNames(["a", "b"], 0), { shown: [], more: 2 });
});
