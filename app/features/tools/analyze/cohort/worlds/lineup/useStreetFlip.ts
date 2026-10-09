"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

/** A re-ordered street walks its buildings to their new lots: 640 ms, a short stagger by distance. */
const WALK_MS = 640;
const WALK_EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * FLIP for the street order toggle. Every building is placed by its column (`--col`), so a new order
 * would teleport it; this hook remembers each building's previous column and plays the difference back
 * as a transform (a building is one pitch wide, so `translateX(100%)` is one lot). A change of order is
 * the only thing that moves a building; reduced motion lands it at once.
 */
export function useStreetFlip(ids: readonly string[]) {
  const reduced = useReducedMotion();
  const els = useRef(new Map<string, HTMLDivElement>());
  const prev = useRef<Map<string, number> | null>(null);
  const setRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);
  // The order as one string (member ids carry no "|"), so a re-render with the same order is no move.
  const key = ids.join("|");

  useLayoutEffect(() => {
    const now = new Map((key ? key.split("|") : []).map((id, i) => [id, i] as const));
    const before = prev.current;
    prev.current = now;
    if (!before || reduced) return;
    const anims: Animation[] = [];
    for (const [id, col] of now) {
      const was = before.get(id);
      const el = els.current.get(id);
      if (was == null || was === col || !el || typeof el.animate !== "function") continue;
      const delta = was - col;
      anims.push(
        el.animate([{ transform: `translateX(${delta * 100}%)` }, { transform: "translateX(0)" }], {
          duration: WALK_MS,
          easing: WALK_EASE,
          delay: Math.min(160, Math.abs(delta) * 8),
          fill: "backwards",
        }),
      );
    }
    return () => anims.forEach((a) => a.cancel());
  }, [key, reduced]);

  return setRef;
}
