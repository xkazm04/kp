// Pins the dock's layer-1 TRANSITIONS — the half of the two-layer rule that
// `simControlDockLayers.test.ts` cannot see, because a pure toggle function
// knows nothing about the companion the transition also has to move.
//
// Non-vacuity: `askCandi` was a one-way raise (`setPanel(null); openDock()`)
// while the row rendered `aria-pressed={companionOpen}` beside it, so a screen
// reader announced a pressed toggle whose second press did nothing. Every
// assertion in "window mode" below fails against that shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dockPanelSlot } from "./dockPanelSlot.ts";
import type { CompanionDockValue } from "@/app/features/shell/companion/CompanionDockProvider";
import type { DockPanelId } from "./simControlDockLayers.ts";

/** The three members of the companion this file's transitions actually touch.
 *  Asserted into the full value because building a thread, a speech engine and
 *  a preferences store to prove a toggle would test the fakes, not the rule. */
function fakeCompanion(open: boolean) {
  const calls: string[] = [];
  const companion = {
    open,
    openDock: () => calls.push("open"),
    closeDock: () => calls.push("close"),
  } as unknown as CompanionDockValue;
  return { companion, calls };
}

function slot(args: {
  panel: DockPanelId | null;
  mode?: "sim" | "ops";
  companionOpen?: boolean;
  candi?: "panel" | "action" | "absent";
}) {
  const panels: (DockPanelId | null)[] = [];
  const started: true[] = [];
  const { companion, calls } =
    args.candi === "absent" ? { companion: null, calls: [] as string[] } : fakeCompanion(args.companionOpen ?? false);
  const api = dockPanelSlot({
    panel: args.panel,
    setPanel: (next) => panels.push(next),
    mode: args.mode ?? "ops",
    companion,
    candi: args.candi ?? "action",
    startSim: () => started.push(true),
  });
  return { ...api, panels, calls, started };
}

test("window-mode Ask Candi TOGGLES her window, so aria-pressed is truthful", () => {
  const closed = slot({ panel: "ops", companionOpen: false });
  assert.notEqual(closed.askCandi, null);
  closed.askCandi?.();
  assert.deepEqual(closed.calls, ["open"]);
  // Raising her empties the slot: the window is the competing surface.
  assert.deepEqual(closed.panels, [null]);

  const open = slot({ panel: null, companionOpen: true });
  open.askCandi?.();
  assert.deepEqual(open.calls, ["close"], "a second press must LOWER her, not re-raise her");
});

test("Ask Candi is null when there is no window to raise", () => {
  assert.equal(slot({ panel: "ops", candi: "absent" }).askCandi, null);
  // In voice mode she is a layer-2 panel, so the row toggles the panel instead.
  assert.equal(slot({ panel: "ops", candi: "panel" }).askCandi, null);
});

test("selecting a non-candi panel lowers her; re-selecting the open one closes it", () => {
  const open = slot({ panel: null, companionOpen: true });
  open.selectPanel("command");
  assert.deepEqual(open.panels, ["command"]);
  assert.deepEqual(open.calls, ["close"]);

  const same = slot({ panel: "command", companionOpen: false });
  same.selectPanel("command");
  assert.deepEqual(same.panels, [null]);
  assert.deepEqual(same.calls, [], "closing a panel is not a reason to touch the companion");
});

test("the voice-mode candi panel is never stored — her own open state carries it", () => {
  const off = slot({ panel: "ops", candi: "panel", companionOpen: false });
  off.selectPanel("candi");
  assert.deepEqual(off.panels, [null]);
  assert.deepEqual(off.calls, ["open"]);

  const on = slot({ panel: "candi", candi: "panel", companionOpen: true });
  on.selectPanel("candi");
  assert.deepEqual(on.panels, [null]);
  assert.deepEqual(on.calls, ["close"]);
});

test("the guide button's three branches move the slot the way guideAction says", () => {
  const close = slot({ panel: "sim", mode: "sim" });
  close.onGuide();
  assert.deepEqual(close.panels, [null]);

  const open = slot({ panel: "ops", mode: "sim" });
  open.onGuide();
  assert.deepEqual(open.panels, ["sim"]);

  const start = slot({ panel: "ops", mode: "ops" });
  start.onGuide();
  assert.deepEqual(start.panels, []);
  assert.deepEqual(start.started, [true]);
});
