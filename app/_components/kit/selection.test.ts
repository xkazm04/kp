// A kit select mode's pure half (selection.ts): what "select all shown" does, what one toggle does,
// and the over-reach count the BulkBar states before any bulk action. Added with the Pipeline
// parity port; the rules are the retired board's (pipelineSelectionScope.test.ts, subwayInteraction).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allState, ariaChecked, selectedOutside, toggleAll, toggleKey } from "./selection.ts";

test("allState reads none / some / all over what is shown; nothing shown is none", () => {
  const sel = new Set(["a", "b"]);
  assert.equal(allState(sel, []), "none");
  assert.equal(allState(sel, ["c"]), "none");
  assert.equal(allState(sel, ["a", "c"]), "some");
  assert.equal(allState(sel, ["a", "b"]), "all");
  assert.equal(ariaChecked("some"), "mixed");
  assert.equal(ariaChecked("all"), true);
  assert.equal(ariaChecked("none"), false);
});

test("select all shown adds the rest; a fully selected view clears only what it shows", () => {
  const sel = new Set(["a", "x"]);
  assert.deepEqual([...toggleAll(sel, ["a", "b"])].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleAll(new Set(["a", "b", "x"]), ["a", "b"])], ["x"], "keys outside the view survive");
  assert.deepEqual([...sel].sort(), ["a", "x"], "the input set is never mutated (it is React state)");
});

test("one toggle flips one key and nothing else", () => {
  assert.deepEqual([...toggleKey(new Set(["a"]), "b")].sort(), ["a", "b"]);
  assert.deepEqual([...toggleKey(new Set(["a", "b"]), "a")], ["b"]);
});

test("the over-reach: selected keys the view does not show", () => {
  assert.equal(selectedOutside(new Set(["a", "b", "c"]), ["a"]), 2);
  assert.equal(selectedOutside(new Set(), ["a"]), 0);
});

test("the checkbox never lets its click reach the row under it (a row click opens the pane)", () => {
  const src = readFileSync(new URL("./SelectBox.tsx", import.meta.url), "utf8");
  assert.match(src, /role="checkbox"/);
  assert.match(src, /e\.stopPropagation\(\);\s*onToggle\(\);/);
});

test("the bulk bar announces its status line", () => {
  const src = readFileSync(new URL("./BulkBar.tsx", import.meta.url), "utf8");
  assert.match(src, /aria-live="polite"/);
});
