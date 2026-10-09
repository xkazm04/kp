"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

// Arrow keys already mean something inside these (the weave's grid, the pulled row, a segmented control…).
const OWNS_ARROWS = '[role="grid"],[role="toolbar"],[role="tablist"],[role="radiogroup"],[role="group"],[role="listbox"],[role="menu"],[role="slider"]';

/**
 * The Loom's level keys, one document listener (the Night Post's yield rules):
 *   Esc        level 1 -> the loom. It yields to an open modal, to a focused field (blurred first),
 *              to a key already handled and to keys pressed outside the world.
 *   [ ]        level 1: the row above / below (a sideways step).
 *   ← →        level 1: the same, unless focus is in a control that owns its arrows.
 * The weave's own arrows (level 0) live on its grid (LoomWeave). No bare letters: the workspace owns `g`.
 */
export function useLoomKeys(rootRef: RefObject<HTMLElement | null>, handlers: { level: number; onBack: () => void; onStep: (delta: 1 | -1) => void }): void {
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
        e.preventDefault();
        if (isEditable(t)) {
          t.blur();
          return;
        }
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
