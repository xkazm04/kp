"use client";

import { useEffect, useRef } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";
import { isTypingTarget } from "./gigsLogic";

// Bare-key shortcuts for the Gigs tab (N and / on the line, 1-6 on the desk's checklist,
// Esc / Left / Right / D on a gig's page), with the guards the shell's own shortcuts use:
// never while typing in a field, never under a modal, never with a modifier - and never
// as the second key of a `g` chord (`g d` is the shell's jump to Decisions, not "decline").
// The shell's chord window is 1.5s (WorkspaceKeyboardShortcuts.tsx); a key inside it
// after a bare `g` is left alone. A key another listener already handled
// (`defaultPrevented`: the companion's Esc, a toolbar's arrows) is left alone too.
//
// The arrows get one more guard: they belong to whatever the focus is in when that thing
// uses them itself - a composite widget with a roving focus (toolbar, tablist, radio
// group, listbox, menu, grid, slider, tree) or a region that scrolls. Pressing Right
// inside the untrusted listing's scroll box scrolls it; it does not change the gig.
//
// Handlers receive `e.key` lower-cased: "escape", "arrowleft", "arrowright", "d", "1"...

const CHORD_WINDOW_MS = 1500;

const ARROW_OWNER_ROLES = "[role='toolbar'], [role='tablist'], [role='radiogroup'], [role='listbox'], [role='menu'], [role='menubar'], [role='grid'], [role='slider'], [role='tree'], [role='spinbutton']";

/** Whether the element (or an ancestor up to the body) uses the arrow keys itself. */
function arrowsOwnedBy(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.closest(ARROW_OWNER_ROLES)) return true;
  for (let el: HTMLElement | null = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    if (scrollsX || scrollsY) return true;
  }
  return false;
}

/** `handler` answers true when it consumed the key. */
export function useBareKeys(handler: (key: string) => boolean, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isAnyModalOpen()) return;
      const key = e.key.toLowerCase();
      if (key === "g" && !e.shiftKey) {
        lastG = Date.now();
        return;
      }
      if (lastG && Date.now() - lastG < CHORD_WINDOW_MS) {
        lastG = 0;
        return;
      }
      lastG = 0;
      if ((key === "arrowleft" || key === "arrowright") && (e.shiftKey || arrowsOwnedBy(e.target))) return;
      if (ref.current(key)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
