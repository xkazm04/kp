// Pins the rules the two-layer control dock is built on, so none can be
// re-broken by a refactor of the .tsx above them.
//
// Non-vacuity: before the two-layer redesign the dock had NO exclusive-panel
// state at all — the ops face carried an independent `scheduleOpen` boolean and
// the command bar was always mounted, so two surfaces were routinely open at
// once and no pre-change implementation can satisfy the toggle assertions here.
// Likewise the icon row did not exist, so nothing answered an arrow key. Round 3
// closed the last hole in that rule (`scheduleOpen` survived INSIDE the ops
// panel until it became a panel of its own) and collapsed the guided demo's two
// entry points into one, so the composition assertions below fail against both
// earlier shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_PANEL_IDS,
  DOCK_TOOLBAR_PANEL_IDS,
  guideAction,
  nextToolbarIndex,
  toggleDockPanel,
} from "./simControlDockLayers.ts";

test("selecting a different layer-1 option replaces the open panel (mutual exclusion)", () => {
  assert.equal(toggleDockPanel("ops", "command"), "command");
  assert.equal(toggleDockPanel("sim", "ops"), "ops");
  assert.equal(toggleDockPanel("ops", "schedule"), "schedule");
});

test("re-selecting the ACTIVE option closes its panel", () => {
  assert.equal(toggleDockPanel("ops", "ops"), null);
  assert.equal(toggleDockPanel("schedule", "schedule"), null);
});

test("selecting from a closed dock opens that panel", () => {
  assert.equal(toggleDockPanel(null, "sim"), "sim");
  assert.equal(toggleDockPanel(null, "schedule"), "schedule");
});

test("'askCandi' is not a panel id — it is an action, so it cannot occupy the slot", () => {
  assert.ok(!(DOCK_PANEL_IDS as readonly string[]).includes("askCandi"));
  assert.deepEqual([...DOCK_PANEL_IDS], ["sim", "ops", "command", "schedule"]);
});

test("Schedule is a first-class layer-2 panel, not a drawer inside the ops panel", () => {
  // The round-2A open question: with the scheduler on the single `panel` slot,
  // one-surface-at-a-time holds inside the panel too — opening it closes ops.
  assert.ok((DOCK_PANEL_IDS as readonly string[]).includes("schedule"));
  assert.ok((DOCK_TOOLBAR_PANEL_IDS as readonly string[]).includes("schedule"));
  assert.equal(toggleDockPanel("ops", "schedule"), "schedule");
});

test("the layer-1 row offers every panel EXCEPT the guided demo", () => {
  // Round 3: the console is reached from the ONE guide button outside the
  // panel's right border, so the row lost its 'Guided demo' slot.
  assert.deepEqual([...DOCK_TOOLBAR_PANEL_IDS], ["ops", "command", "schedule"]);
  assert.ok(!(DOCK_TOOLBAR_PANEL_IDS as readonly string[]).includes("sim"));
  // …and every row option is still a real panel id.
  for (const id of DOCK_TOOLBAR_PANEL_IDS) assert.ok((DOCK_PANEL_IDS as readonly string[]).includes(id));
});

test("the guide button starts a demo at rest and toggles the console once one is live", () => {
  assert.equal(guideAction(null, "ops"), "start");
  assert.equal(guideAction("ops", "ops"), "start");
  assert.equal(guideAction("schedule", "ops"), "start");
  assert.equal(guideAction(null, "sim"), "open");
  assert.equal(guideAction("command", "sim"), "open");
  // Whatever the mode, pressing it while the console is up closes the console —
  // it never restarts a run the operator is already watching.
  assert.equal(guideAction("sim", "sim"), "close");
  assert.equal(guideAction("sim", "ops"), "close");
});

test("arrow keys move focus along the row and wrap at both ends", () => {
  assert.equal(nextToolbarIndex(0, "ArrowRight", 4), 1);
  assert.equal(nextToolbarIndex(3, "ArrowRight", 4), 0);
  assert.equal(nextToolbarIndex(0, "ArrowLeft", 4), 3);
  assert.equal(nextToolbarIndex(2, "ArrowLeft", 4), 1);
});

test("the round-3 row composition roves over exactly its own controls", () => {
  // [Automations][Command][Schedule][Ask Candi] — four, and three on the
  // deep-link pages where there is no companion dock to ask.
  const withCandi = DOCK_TOOLBAR_PANEL_IDS.length + 1;
  const withoutCandi = DOCK_TOOLBAR_PANEL_IDS.length;
  assert.equal(withCandi, 4);
  assert.equal(withoutCandi, 3);
  assert.equal(nextToolbarIndex(2, "ArrowRight", withCandi), 3); // Schedule → Ask Candi
  assert.equal(nextToolbarIndex(3, "ArrowRight", withCandi), 0); // Ask Candi → Automations
  assert.equal(nextToolbarIndex(0, "ArrowLeft", withCandi), 3);
  assert.equal(nextToolbarIndex(withCandi - 1, "ArrowRight", withCandi), 0);
  // Without the companion the row is one shorter and must still wrap cleanly —
  // the guide button is NOT a member (it lives outside the panel's border and
  // owns its own tab stop), so it never enters this count.
  assert.equal(nextToolbarIndex(2, "ArrowRight", withoutCandi), 0);
  assert.equal(nextToolbarIndex(0, "ArrowLeft", withoutCandi), 2);
  assert.equal(nextToolbarIndex(0, "End", withoutCandi), 2);
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
