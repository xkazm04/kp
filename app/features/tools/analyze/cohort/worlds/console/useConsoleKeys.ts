"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

// Arrow keys already mean something inside these (the soloed bus strip, a segmented control, a tablist…).
const OWNS_ARROWS = '[role="tablist"],[role="radiogroup"],[role="group"],[role="listbox"],[role="menu"],[role="grid"],[role="slider"],[data-owns-arrows]';

/**
 * The desk's level keys, one document listener (the desk's own arrows live on its grid):
 *   Esc        one level up from a soloed bus. Yields, in order, to an open modal, a focused field
 *              (blurred first), an open kit reading pane inside the level, and keys pressed outside
 *              the world. Handled = preventDefault.
 *   [ ]        the previous / next bus, anywhere in a soloed level outside a field.
 *   ← →        the same, while focus is in the level but not in a control that owns its arrows.
 * No bare letters: they would collide with the workspace's `g` chords.
 */
export function useConsoleKeys(rootRef: RefObject<HTMLElement | null>, handlers: { level: number; onBack: () => void; onStep: (delta: 1 | -1) => void }): void {
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
      const { level, onBack, onStep } = ref.current;
      if (level === 0) return;
      if (e.key === "Escape") {
        if (isEditable(t)) {
          e.preventDefault();
          t.blur();
          return;
        }
        const top = root.querySelector('.cx-layer[data-mode="flow"], .cx-layer[data-mode="entering"]');
        if (top?.querySelector('.k-stage[data-detail="open"]')) return;
        e.preventDefault();
        onBack();
        return;
      }
      if (isEditable(t)) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        onStep(e.key === "]" ? 1 : -1);
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !(t instanceof Element && t.closest(OWNS_ARROWS))) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
}
