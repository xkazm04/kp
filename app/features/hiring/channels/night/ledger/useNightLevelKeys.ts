"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

/** The workspace's chord window: a key pressed within it after a bare `g` is the chord's
 *  (WorkspaceKeyboardShortcuts.tsx: `g d` is the jump to Decisions, `g 1`... never ours). */
const CHORD_WINDOW_MS = 1500;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

/**
 * A level's own bare keys (the post book's 1-7, / and the row keys; the letter's [ ]), with the
 * same yield rules as the shell's `useChannelsNightKeys`: never with a modifier, never while a
 * field has focus or a modal is open, never for a key another listener already handled, never
 * the second key of a workspace `g` chord, and only while this level is the one on top (a covered
 * level stays mounted, hidden, under the next one) and the key was pressed inside that level's
 * layer (or on the page body). `rootRef` is any element inside the level. Esc is not handled here:
 * it is the shell's, one level up everywhere.
 *
 * `onKey` answers true when it used the key (then the default is prevented).
 */
export function useNightLevelKeys(rootRef: RefObject<HTMLElement | null>, onKey: (e: KeyboardEvent) => boolean): void {
  const ref = useRef(onKey);
  useEffect(() => {
    ref.current = onKey;
  });
  useEffect(() => {
    let lastG = 0;
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key === "Escape") return;
      if (isEditable(e.target) || isAnyModalOpen()) return;
      if (e.key.toLowerCase() === "g" && !e.shiftKey) {
        lastG = Date.now();
        return;
      }
      if (lastG && Date.now() - lastG < CHORD_WINDOW_MS) {
        lastG = 0;
        return;
      }
      // The level is its kit layer (.k-layer, LevelTransition): the heading, trail and foot count.
      const layer = rootRef.current?.closest(".k-layer");
      if (!layer) return;
      const mode = layer.getAttribute("data-mode");
      if (mode !== "flow" && mode !== "entering" && mode !== "swapping") return;
      const t = e.target;
      if (!(t instanceof Node && layer.contains(t)) && t !== document.body) return;
      if (ref.current(e)) e.preventDefault();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [rootRef]);
}
