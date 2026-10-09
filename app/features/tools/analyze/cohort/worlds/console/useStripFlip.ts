"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

const FLIP_MS = 420;

/**
 * Re-patching the desk (neutral <-> by fit) slides every strip from where it stood to where it now
 * stands (FLIP over `[data-flip]` elements, which React keeps by member id): the same channels,
 * moved, never a redraw. `snapshot()` is called just before the order changes; the slide plays
 * after the next layout. Reduced motion: the strips are simply in their new places.
 */
export function useStripFlip(rootRef: RefObject<HTMLElement | null>, orderKey: string): () => void {
  const reduced = useReducedMotion();
  const before = useRef<Map<Element, number> | null>(null);

  const snapshot = useCallback(() => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const map = new Map<Element, number>();
    root.querySelectorAll("[data-flip]").forEach((el) => map.set(el, el.getBoundingClientRect().left));
    before.current = map;
  }, [rootRef, reduced]);

  useLayoutEffect(() => {
    const map = before.current;
    before.current = null;
    if (!map) return;
    const anims: Animation[] = [];
    map.forEach((left, el) => {
      if (!(el instanceof HTMLElement) || !el.isConnected || typeof el.animate !== "function") return;
      const dx = left - el.getBoundingClientRect().left;
      if (Math.abs(dx) < 1) return;
      anims.push(el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: "cubic-bezier(.2,.8,.2,1)" }));
    });
    // A slide that never paints (a hidden tab) is cancelled by its timer: the strips stand where they are.
    const timer = window.setTimeout(() => anims.forEach((a) => a.cancel()), FLIP_MS + 160);
    return () => window.clearTimeout(timer);
  }, [orderKey]);

  return snapshot;
}
