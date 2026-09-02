// The board filter menu's KEYBOARD CONTRACT.
//
// PipelineFilterMenu is a portalled combobox with VIRTUAL focus: DOM focus never
// leaves the trigger, and `aria-activedescendant` is the only thing that says which
// option is current. Every one of those pieces is load-bearing and none of them was
// tested — arrow wrap-around, Home/End, Escape returning focus to the trigger, Tab
// leaving it where the browser put it, an open menu eating the keys it handles so
// one Escape cannot also close a surrounding dialog, and the `onMouseDown`
// preventDefault that keeps a mouse click from stealing focus away from the only
// element listening for those keys.
//
// So the decision half is a pure reducer (this module's subject) and the wiring half
// — which cannot be run without a DOM here — is pinned as a source guard, the same
// shape drawerCommsTruth.test.ts uses.
//
// Runner: node:test with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync as read } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filterMenuKeyAction, nextActiveIndex } from "./pipelineFilterMenuKeys.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const MENU = "app/features/hiring/pipeline/PipelineFilterMenu.tsx";
const src = () => read(resolve(ROOT, MENU), "utf8");

// --- closed: the four keys that OPEN it, and nothing else --------------------------

test("a closed trigger opens on both arrows and both activation keys", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    const a = filterMenuKeyAction(key, false);
    assert.equal(a.kind, "open", key);
    assert.equal(a.preventDefault, true, `${key} must not also scroll the page / submit`);
  }
});

test("a closed trigger ignores everything else — Escape included", () => {
  // Escape on a CLOSED facet belongs to whatever surrounds it (the drawer, a modal).
  // Swallowing it here would make the board bar a key sink.
  for (const key of ["Escape", "Tab", "a", "Home", "End", "ArrowLeft"]) {
    assert.equal(filterMenuKeyAction(key, false).kind, "ignore", key);
    assert.equal(filterMenuKeyAction(key, false).preventDefault, false, key);
  }
});

// --- open: navigation -------------------------------------------------------------

test("arrows step the virtual focus one option at a time", () => {
  assert.deepEqual(filterMenuKeyAction("ArrowDown", true), { kind: "move", delta: 1, preventDefault: true });
  assert.deepEqual(filterMenuKeyAction("ArrowUp", true), { kind: "move", delta: -1, preventDefault: true });
});

test("Home and End jump to the ends", () => {
  assert.equal(filterMenuKeyAction("Home", true).kind, "first");
  assert.equal(filterMenuKeyAction("End", true).kind, "last");
});

test("the active index WRAPS in both directions", () => {
  assert.equal(nextActiveIndex(2, 1, 3), 0, "past the end returns to the first option");
  assert.equal(nextActiveIndex(0, -1, 3), 2, "before the start returns to the last");
  assert.equal(nextActiveIndex(0, 1, 3), 1);
});

test("an empty facet cannot move its virtual focus off zero", () => {
  // A facet with no options (a board with no sources yet) must not compute an index
  // modulo zero — that is NaN, and NaN on aria-activedescendant names nothing.
  assert.equal(nextActiveIndex(0, 1, 0), 0);
  assert.equal(nextActiveIndex(0, -1, 0), 0);
});

// --- open: commit and dismissal ---------------------------------------------------

test("Enter and Space commit the active option", () => {
  for (const key of ["Enter", " "]) {
    const a = filterMenuKeyAction(key, true);
    assert.equal(a.kind, "commit", key);
    assert.equal(a.preventDefault, true, `${key} must not scroll or re-fire the trigger's click`);
  }
});

test("Escape closes AND returns focus to the trigger", () => {
  const a = filterMenuKeyAction("Escape", true);
  assert.equal(a.kind, "close");
  assert.equal(a.returnFocus, true, "focus must come back to the control the reader was on");
  assert.equal(a.preventDefault, true);
});

test("Tab closes but leaves focus to the browser", () => {
  const a = filterMenuKeyAction("Tab", true);
  assert.equal(a.kind, "close");
  assert.equal(a.returnFocus, false, "pulling focus back would trap the reader in the facet bar");
  assert.equal(a.preventDefault, false, "the tab itself must still move on");
});

test("an unhandled key while open changes nothing", () => {
  assert.equal(filterMenuKeyAction("q", true).kind, "ignore");
});

// --- the wiring the reducer cannot own --------------------------------------------

test("the component decides keys through the shared reducer, not a private switch", () => {
  assert.match(src(), /filterMenuKeyAction\(/);
  assert.match(src(), /nextActiveIndex\(/);
});

test("an open menu eats the keys it handles so one Escape closes ONE layer", () => {
  assert.match(src(), /selectConsumesKeyWhileOpen\(e\.key\)\) e\.stopPropagation\(\)/);
});

test("virtual focus is intact: the options never take DOM focus", () => {
  const s = src();
  assert.match(s, /aria-activedescendant=/, "the trigger names the active option");
  assert.match(s, /tabIndex=\{-1\}/, "option buttons are out of the tab order");
  assert.match(
    s,
    /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/,
    "a mouse click must not move DOM focus off the trigger — the next Escape/Arrow would go nowhere"
  );
});
