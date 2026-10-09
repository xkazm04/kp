"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

/** Inside these, ← → already mean something (a group of doors, a tablist, a segmented control, a grid). */
const OWNS_ARROWS = '[role="tablist"],[role="radiogroup"],[role="group"],[role="listbox"],[role="menu"],[role="grid"],[role="slider"],[data-lu-strip]';

/**
 * The Line-up's level keys, one listener (the street's own arrows are handled on the street):
 *   Esc     back out to the street. Yields to an open modal, to a focused field (blurred first),
 *           to an open kit reading pane inside the floor, and to keys pressed outside the world.
 *   [ ]     the stairs: up / down a floor, anywhere on a floor but in a field.
 *   ← →     the stairs too, while focus is on the floor itself (its heading, its text), not in a
 *           control that owns its arrows.
 * Brackets and arrows are not letters: the workspace's `g` chords never see a collision.
 */
export function useLineupKeys(rootRef: RefObject<HTMLElement | null>, handlers: { level: number; onBack: () => void; onStairs: (delta: 1 | -1) => void }): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isAnyModalOpen()) return;
      const root = rootRef.current;
      const t = e.target;
      const inside = t instanceof Node && root !== null && root.contains(t);
      if (!root || (!inside && t !== document.body)) return;
      const { level, onBack, onStairs } = ref.current;
      if (level === 0) return;
      if (e.key === "Escape") {
        if (isEditable(t)) {
          e.preventDefault();
          t.blur();
          return;
        }
        const top = root.querySelector('.k-layer[data-mode="flow"], .k-layer[data-mode="entering"], .k-layer[data-mode="swapping"]');
        if (top?.querySelector('.k-stage[data-detail="open"]')) return;
        e.preventDefault();
        onBack();
        return;
      }
      if (isEditable(t)) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        onStairs(e.key === "]" ? 1 : -1);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (t instanceof Element && (t.closest(OWNS_ARROWS) || t.closest("button,a,input,select,textarea,[tabindex]:not([data-level-heading])"))) return;
      e.preventDefault();
      onStairs(e.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
}
