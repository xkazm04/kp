"use client";

// The dock's panel-slot transitions, in one place because they are one rule seen
// from several angles: there is a single layer-2 slot and only one thing may be
// in it. Split out of SimControlDock.tsx to keep it under the 200-line file cap —
// the same reason its faces, its orb, its rail and its panel body are each their
// own file.
//
// Deliberately NOT a `use*` hook: it calls none, and the dock reaches it after the
// collapsed early-return, where a real hook could not be called at all.
//
// ROUND V3 split the Candi transition in two by MODE (`candiControl`). In `voice`
// she is a panel like the others; in `dock` she stays the round-3 ACTION that
// raises the left window. The one thing worth reading twice: the candi panel is
// NOT stored in the `panel` state. Its openness IS `companion.open`, which
// already exists, is already what the strip at the top of the screen reads, and
// is already what the command palette sets when it opens her from somewhere
// else. Storing it twice would need an effect to keep the two in step, and an
// effect that re-derives exclusivity is exactly what this dock was built without
// (see `effectiveDockPanel`, which does the join in one line, during render).
import type { CompanionDockValue } from "@/app/features/shell/companion/CompanionDockProvider";
import { guideAction, toggleDockPanel, type CandiControl, type DockPanelId } from "./simControlDockLayers";

export function dockPanelSlot({
  panel,
  setPanel,
  mode,
  companion,
  candi,
  startSim,
}: {
  /** The EFFECTIVE panel (`effectiveDockPanel`), not the stored one — every
   *  transition below has to reason about what the operator can see. */
  panel: DockPanelId | null;
  setPanel: (next: DockPanelId | null) => void;
  mode: "sim" | "ops";
  /** Null on the deep-link pages, which render no companion dock. */
  companion: CompanionDockValue | null;
  candi: CandiControl;
  startSim: () => void;
}) {
  /** Rule (b), both directions: picking a layer-1 option opens exactly one panel
   *  (or closes the active one). Opening any panel that is NOT hers lowers the
   *  companion; opening HERS raises it, because in voice mode the strip at the
   *  top of the screen is the other half of this panel and the two belong on
   *  screen together. Closing hers lowers it again — and whether that also stops
   *  the audio is the companion's decision, not this one's. */
  const selectPanel = (id: DockPanelId) => {
    const next = toggleDockPanel(panel, id);
    if (id === "candi") {
      // Never stored: the slot is emptied and her own open state carries it.
      setPanel(null);
      if (next === null) companion?.closeDock();
      else companion?.openDock();
      return;
    }
    setPanel(next);
    if (next !== null) companion?.closeDock();
  };
  /** WINDOW mode only: the row's one control that is not a panel. It empties the
   *  slot and raises the left window instead. Null when the mode makes her a
   *  panel, or when there is no companion at all — so the caller renders a
   *  toggle, an action, or nothing, and never a button that cannot work. */
  const askCandi =
    candi === "action" && companion
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
