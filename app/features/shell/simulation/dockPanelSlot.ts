"use client";

// The dock's THREE panel-slot transitions, in one place because they are one rule
// seen from three angles: there is a single `panel` slot and the companion dock is
// the competing surface, so every one of them closes something. Split out of
// SimControlDock.tsx to keep it under the 200-line file cap — the same reason its
// faces, its orb, its rail and its panel body are each their own file.
//
// Deliberately NOT a `use*` hook: it calls none, and the dock reaches it after the
// collapsed early-return, where a real hook could not be called at all.
import type { CompanionDockValue } from "@/app/features/shell/companion/CompanionDockProvider";
import { guideAction, toggleDockPanel, type DockPanelId } from "./simControlDockLayers";

export function dockPanelSlot({
  panel,
  setPanel,
  mode,
  companion,
  startSim,
}: {
  panel: DockPanelId | null;
  setPanel: (next: DockPanelId | null) => void;
  mode: "sim" | "ops";
  /** Null on the deep-link pages, which render no companion dock. */
  companion: CompanionDockValue | null;
  startSim: () => void;
}) {
  /** Rule (b), both directions: picking a layer-1 option opens exactly one panel
   *  (or closes the active one), and whichever it opens lowers the companion. */
  const selectPanel = (id: DockPanelId) => {
    const next = toggleDockPanel(panel, id);
    setPanel(next);
    if (next !== null) companion?.closeDock();
  };
  /** The row's one ACTION rather than a panel: it empties the slot and raises the
   *  companion instead. Null when there is no dock to raise, so the caller omits
   *  the control rather than rendering a button that cannot work. */
  const askCandi = companion
    ? () => {
        setPanel(null);
        companion.openDock();
      }
    : null;
  /** The rail's guide button, branching on `guideAction()`: close the console,
   *  show it, or begin a run — in the last case the caller's ops → sim effect is
   *  what reveals the console, so this only has to start the thing. */
  const onGuide = () => {
    const action = guideAction(panel, mode);
    if (action === "close") return setPanel(null);
    companion?.closeDock();
    if (action === "open") setPanel("sim");
    else startSim();
  };
  return { selectPanel, askCandi, onGuide };
}
