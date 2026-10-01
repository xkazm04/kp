"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

// Arrow keys already mean something inside these (a tablist, a segmented control, a menu).
const OWNS_ARROWS = '[role="tablist"],[role="radiogroup"],[role="listbox"],[role="menu"],[role="grid"],[role="slider"]';

export type WorkforceKeyHandlers = {
  level: number;
  /** Esc: one level up. At the wheel it clears the filters instead (returns whether it did). */
  onBack: () => void;
  onEscapeAtRoot?: () => boolean;
  /** 1-6: a needs kind (the wheel's queues, a drawer's strip). */
  onDigit?: (n: number) => void;
  /** [ and ]: the next drawer (L1) or card (L2); the arrows do it on a card's front too. */
  onStep?: (delta: 1 | -1) => void;
};

/**
 * The surface's keyboard, one listener for every level. No bare letters (the workspace owns `g` as the
 * prefix of its two-key chords): digits, arrows, brackets, Enter (the focused control's own) and Esc.
 *   Esc        one level up; at the wheel it clears the needs / state filters. It yields to an open modal and to a
 *              focused field (blurred first), and to keys pressed outside the surface.
 *   1-6        a needs kind.
 *   Arrows     between the plates (L0) or the cards (L1) while one has focus (`data-wk-nav`).
 *   [ ]  ← →   the previous / next drawer (L1) or card (L2).
 */
export function useWorkforceKeys(rootRef: RefObject<HTMLElement | null>, handlers: WorkforceKeyHandlers): void {
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
      const { level, onBack, onEscapeAtRoot, onDigit, onStep } = ref.current;
      if (e.key === "Escape") {
        if (isEditable(t)) {
          e.preventDefault();
          t.blur();
          return;
        }
        if (level === 0) {
          if (onEscapeAtRoot?.()) e.preventDefault();
          return;
        }
        e.preventDefault();
        onBack();
        return;
      }
      if (isEditable(t)) return;
      if (/^[1-6]$/.test(e.key) && onDigit && !e.shiftKey) {
        e.preventDefault();
        onDigit(Number(e.key));
        return;
      }
      if (onStep && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        onStep(e.key === "]" ? 1 : -1);
        return;
      }
      if (t instanceof Element && t.closest(OWNS_ARROWS)) return;
      const isArrow = e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!isArrow) return;
      if (t instanceof HTMLElement && t.dataset.wkNav !== undefined) {
        const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
        const top = t.closest(".k-layer");
        const nodes = [...(top ?? root).querySelectorAll<HTMLElement>("[data-wk-nav]")].filter((n) => n.getClientRects().length > 0);
        const at = nodes.indexOf(t);
        if (at < 0) return;
        e.preventDefault();
        nodes[(at + (fwd ? 1 : nodes.length - 1)) % nodes.length].focus();
        return;
      }
      if (level === 2 && onStep && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
}
