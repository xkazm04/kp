"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

// Arrow keys already mean something inside these (a tablist, a segmented control, a menu).
const OWNS_ARROWS = '[role="tablist"],[role="radiogroup"],[role="group"],[role="listbox"],[role="menu"],[role="grid"],[role="slider"]';

/**
 * The surface's keyboard, one listener for every level:
 *   Esc          one level up (never at the plumbing). It yields, in order, to an open modal,
 *                to a focused field (blurred first, like the kit's keys), to an open kit reading
 *                pane inside the level (the kit closes that), and to keys pressed outside the
 *                surface (the control dock owns those). Handled = preventDefault, so the dock's
 *                own Escape reader ignores it.
 *   Arrows (L0)  walk the buildings, in reading order, while a building has focus.
 *   ← → (L1)     the previous / next channel, while focus is on the level but not in a control
 *                that owns its arrows.
 * No bare letters: they would collide with the workspace's `g` chords.
 */
export function useChannelsNightKeys(
  rootRef: RefObject<HTMLElement | null>,
  handlers: { level: number; onBack: () => void; onStepChannel?: (delta: 1 | -1) => void },
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isAnyModalOpen()) return;
      const root = rootRef.current;
      if (!root) return;
      const t = e.target;
      const inside = t instanceof Node && root.contains(t);
      if (!inside && t !== document.body) return;
      const { level, onBack, onStepChannel } = ref.current;
      if (e.key === "Escape") {
        if (level === 0) return;
        if (isEditable(t)) {
          e.preventDefault();
          t.blur();
          return;
        }
        const top = root.querySelector(`.k-layer[data-mode="flow"], .k-layer[data-mode="entering"]`);
        if (top?.querySelector('.k-stage[data-detail="open"]')) return;
        e.preventDefault();
        onBack();
        return;
      }
      if (isEditable(t) || (t instanceof Element && t.closest(OWNS_ARROWS))) return;
      if (level === 0 && t instanceof HTMLElement && t.dataset.nightNode) {
        const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
        const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
        if (!fwd && !back) return;
        const nodes = [...root.querySelectorAll<HTMLElement>('.k-layer[data-depth="0"] button[data-night-node]')].filter((n) => n.getClientRects().length > 0);
        const at = nodes.indexOf(t);
        if (at < 0) return;
        e.preventDefault();
        nodes[(at + (fwd ? 1 : nodes.length - 1)) % nodes.length].focus();
        return;
      }
      if (level === 1 && onStepChannel && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onStepChannel(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
}
