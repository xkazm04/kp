// Pins the two rules the two-layer control dock is built on, so neither can be
// re-broken by a refactor of the .tsx above them.
//
// Non-vacuity: before the two-layer redesign the dock had NO exclusive-panel
// state at all — the ops face carried an independent `scheduleOpen` boolean and
// the command bar was always mounted, so two surfaces were routinely open at
// once and no pre-change implementation can satisfy the toggle assertions here.
// Likewise the icon row did not exist, so nothing answered an arrow key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCK_PANEL_IDS, nextToolbarIndex, toggleDockPanel } from "./simControlDockLayers.ts";

test("selecting a different layer-1 option replaces the open panel (mutual exclusion)", () => {
  assert.equal(toggleDockPanel("ops", "command"), "command");
  assert.equal(toggleDockPanel("sim", "ops"), "ops");
});

test("re-selecting the ACTIVE option closes its panel", () => {
  assert.equal(toggleDockPanel("ops", "ops"), null);
});

test("selecting from a closed dock opens that panel", () => {
  assert.equal(toggleDockPanel(null, "sim"), "sim");
});

test("'askCandi' is not a panel id — it is an action, so it cannot occupy the slot", () => {
  assert.ok(!(DOCK_PANEL_IDS as readonly string[]).includes("askCandi"));
  assert.deepEqual([...DOCK_PANEL_IDS], ["sim", "ops", "command"]);
});

test("arrow keys move focus along the row and wrap at both ends", () => {
  assert.equal(nextToolbarIndex(0, "ArrowRight", 4), 1);
  assert.equal(nextToolbarIndex(3, "ArrowRight", 4), 0);
  assert.equal(nextToolbarIndex(0, "ArrowLeft", 4), 3);
  assert.equal(nextToolbarIndex(2, "ArrowLeft", 4), 1);
});

test("the vertical pair works too — the row wraps on narrow viewports", () => {
  assert.equal(nextToolbarIndex(1, "ArrowDown", 4), 2);
  assert.equal(nextToolbarIndex(1, "ArrowUp", 4), 0);
});

test("Home/End jump to the ends", () => {
  assert.equal(nextToolbarIndex(2, "Home", 4), 0);
  assert.equal(nextToolbarIndex(1, "End", 4), 3);
});

test("keys the toolbar does not own return null, so the caller leaves them alone", () => {
  assert.equal(nextToolbarIndex(0, "Escape", 4), null);
  assert.equal(nextToolbarIndex(0, "Enter", 4), null);
  assert.equal(nextToolbarIndex(0, "Tab", 4), null);
});

test("an out-of-range or empty row cannot produce an out-of-range index", () => {
  assert.equal(nextToolbarIndex(0, "ArrowRight", 0), null);
  assert.equal(nextToolbarIndex(99, "ArrowRight", 3), 1); // treated as index 0
  assert.equal(nextToolbarIndex(-1, "ArrowLeft", 3), 2);
});
