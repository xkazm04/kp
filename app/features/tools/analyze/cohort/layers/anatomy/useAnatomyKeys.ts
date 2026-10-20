"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { stepMember } from "../../dimensions/dimensionModel";

/** The workspace's chord window: a key within it after a bare `g` belongs to the `g` chord. */
const CHORD_WINDOW_MS = 1500;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

const stopSelector = (id: string) => `[data-dim-stop][data-dim-member="${CSS.escape(id)}"]`;

/**
 * The anatomy's member keys: j / k and ↓ / ↑ walk the candidates (the field's rows, then the
 * not-compared chips), INSIDE the layer only, so the world's own keys stay its own (← → and [ ]
 * are its stairs). Yields to a modifier, a field, a key already handled and the second key of a
 * workspace `g` chord. A member focused AFTER mount is scrolled into view; the first render never
 * scrolls (the world owns the descent's positioning).
 */
export function useAnatomyKeys(root: RefObject<HTMLElement | null>, focusId: string | null, onFocusMember: (id: string | null) => void) {
  const reduced = useReducedMotion();
  const lastG = useRef(0);
  const prevFocus = useRef(focusId);
  useEffect(() => {
    if (prevFocus.current === focusId) return;
    prevFocus.current = focusId;
    if (!focusId) return;
    root.current?.querySelector<HTMLElement>(stopSelector(focusId))?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [focusId, reduced, root]);

  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
    if (e.key.toLowerCase() === "g" && !e.shiftKey) {
      lastG.current = Date.now();
      return;
    }
    const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    if (lastG.current && Date.now() - lastG.current < CHORD_WINDOW_MS) {
      lastG.current = 0;
      return;
    }
    const stops = [...(root.current?.querySelectorAll<HTMLElement>("[data-dim-stop]") ?? [])];
    const ids = stops.map((el) => el.dataset.dimMember ?? "");
    const here = e.target instanceof Element ? (e.target.closest("[data-dim-member]") as HTMLElement | null)?.dataset.dimMember : undefined;
    const next = stepMember(ids, here ?? focusId, delta);
    if (!next) return;
    e.preventDefault();
    stops[ids.indexOf(next)]?.focus();
    onFocusMember(next);
  };
}
