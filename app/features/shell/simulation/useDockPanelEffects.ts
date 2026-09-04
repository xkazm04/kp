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
import { dockEscapeAction, type DockPanelId } from "./simControlDockLayers";

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
  // is the affordance that says how to get the panel back. The whole decision
  // (is this key ours? did something above us already answer it? where does
  // focus go?) is `dockEscapeAction`, pure and pinned beside it; this effect is
  // only the plumbing that asks and obeys.
  useEffect(() => {
    if (collapsed || shown === null || modalUp) return;
    const onKey = (e: KeyboardEvent) => {
      const act = dockEscapeAction({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        collapsed,
        shown,
        modalUp,
      });
      if (!act) return;
      // Mark it handled, both directions: the companion's `document` listener
      // runs FIRST (propagation reaches document before window) and now marks
      // its own, which is what the guard above reads; this marks ours so any
      // later listener on `window` shows the operator the same courtesy.
      e.preventDefault();
      if (act.closeCompanion) closeDock?.();
      setPanel(null);
      // The dock is chrome, not a modal — no trap to release — but a panel
      // dismissed from the keyboard must not drop focus onto the body. Read from
      // the DOM rather than plumbed as a ref: the ids are already the ARIA
      // association between each control and the region it opens, and one of the
      // targets (the guide button) is outside the toolbar entirely.
      document.getElementById(act.focusId)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, shown, modalUp, setPanel, closeDock]);
}
