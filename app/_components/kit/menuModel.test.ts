// The kit Menu's contract (menuModel.ts is the decision half; Menu.tsx the wiring half, pinned by source).
// Recovered from the retired board's facet-menu tests (pipelineFilterMenuKeys.test.ts, deleted at
// b7fde0c32) when the Pipeline parity port brought the facets back on the kit.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { menuKeyAction, menuPlacement, menuSummary, nextActiveIndex } from "./menuModel.ts";

test("closed: only the arrows and the activation keys open it; Escape is left to the surroundings", () => {
  for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) assert.equal(menuKeyAction(k, false).kind, "open");
  for (const k of ["Escape", "Tab", "a", "Home", "m"]) assert.deepEqual(menuKeyAction(k, false), { kind: "ignore", preventDefault: false });
});

test("open: arrows move, Home/End jump, Enter/Space commit, Escape returns focus, Tab does not trap", () => {
  assert.deepEqual(menuKeyAction("ArrowDown", true), { kind: "move", delta: 1, preventDefault: true });
  assert.deepEqual(menuKeyAction("ArrowUp", true), { kind: "move", delta: -1, preventDefault: true });
  assert.equal(menuKeyAction("Home", true).kind, "first");
  assert.equal(menuKeyAction("End", true).kind, "last");
  assert.equal(menuKeyAction("Enter", true).kind, "commit");
  assert.equal(menuKeyAction(" ", true).kind, "commit");
  assert.deepEqual(menuKeyAction("Escape", true), { kind: "close", returnFocus: true, preventDefault: true });
  assert.deepEqual(menuKeyAction("Tab", true), { kind: "close", returnFocus: false, preventDefault: false });
});

test("the virtual focus wraps, skips disabled options and never answers NaN", () => {
  assert.equal(nextActiveIndex(2, 1, [false, false, false]), 0);
  assert.equal(nextActiveIndex(0, -1, [false, false, false]), 2);
  assert.equal(nextActiveIndex(0, 1, [false, true, false]), 2);
  assert.equal(nextActiveIndex(-1, 1, [true, false]), 1);
  assert.equal(nextActiveIndex(0, 1, []), 0);
  assert.equal(nextActiveIndex(1, 1, [true, true]), 1);
});

test("a closed facet names the one value on, or the first plus +N, never a bare count", () => {
  assert.equal(menuSummary([]), null);
  assert.equal(menuSummary(["Interview"]), "Interview");
  assert.equal(menuSummary(["Interview", "Aging", "Needs intake"]), "Interview +2");
});

test("the list sits under the trigger, flips above near the bottom edge, and stays inside the viewport", () => {
  const vp = { width: 1280, height: 800 };
  assert.deepEqual(menuPlacement({ top: 100, bottom: 136, left: 40, width: 120 }, { width: 220, height: 200 }, vp), { top: 140, left: 40, minWidth: 200 });
  assert.equal(menuPlacement({ top: 700, bottom: 736, left: 40, width: 120 }, { width: 220, height: 200 }, vp).top, 496);
  assert.equal(menuPlacement({ top: 100, bottom: 136, left: 1200, width: 120 }, { width: 220, height: 200 }, vp).left, 1052);
});

test("the wiring: DOM focus stays on the trigger and an open menu eats the keys a dialog would act on", () => {
  const src = readFileSync(new URL("./Menu.tsx", import.meta.url), "utf8");
  assert.match(src, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/, "a click must not move focus off the trigger");
  assert.match(src, /aria-activedescendant=/);
  assert.match(src, /if \(open && selectConsumesKeyWhileOpen\(e\.key\)\) e\.stopPropagation\(\)/);
  assert.match(src, /createPortal\(/, "the list is portalled so no transformed or clipped parent contains it");
});
