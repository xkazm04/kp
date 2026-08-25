"use client";

// The two ways the control dock's layer-2 slot changes WITHOUT anyone pressing a
// layer-1 control: a guided run beginning, and Escape. Extracted from
// SimControlDock.tsx when round V3 pushed it past the ~200-line file cap — the
// same reason its faces, its orb, its rail, its panel body and its slot
// transitions are each their own file.
//
// They belong together because they are the same question from two ends: what is
// allowed to move the slot that is not a click on the row. Everything else about
// the slot is a pure transition in `dockPanelSlot` / `simControlDockLayers`.
import { useEffect, useRef } from "react";
import type { DockPanelId } from "./simControlDockLayers";

export function useDockPanelEffects({
  mode,
  collapsed,
  setCollapsed,
  /** The EFFECTIVE panel — what the operator can actually see right now. */
  shown,
  setPanel,
  /** A modal of the dock's own is up; Escape must reach the dialog first. */
  modalUp,
  /** Lower the companion. Undefined on the deep-link pages, where there is none. */
  closeDock,
}: {
  mode: "sim" | "ops";
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  shown: DockPanelId | null;
  setPanel: (next: DockPanelId | null) => void;
  modalUp: boolean;
  closeDock: (() => void) | undefined;
}): void {
  // Raise the deck automatically the moment a demo begins (ops → sim), so the tour
  // is visible without hunting for the switch. Fires on the transition only — the
  // viewer can still lower it mid-run, and it is what makes the guide button's
  // `start` branch reveal the console: pressing it flips the mode, and this lands.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (mode === "sim" && prevMode.current !== "sim") {
      setCollapsed(false);
      setPanel("sim");
      // …and lower the companion, or the console would be revealed underneath a
      // candi panel, which wins the tie in `effectiveDockPanel`.
      closeDock?.();
    }
    prevMode.current = mode;
  }, [mode, setCollapsed, setPanel, closeDock]);

  // Escape closes the OPEN PANEL, not the deck — the layer-1 row stays put, which
  // is the affordance that says how to get the panel back.
  useEffect(() => {
    if (collapsed || shown === null || modalUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Her panel's state is her own `open`, so emptying the slot is not enough:
      // without this, Escape would hide the input and leave the strip on screen
      // with nothing to type into.
      if (shown === "candi") closeDock?.();
      setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, shown, modalUp, setPanel, closeDock]);
}
