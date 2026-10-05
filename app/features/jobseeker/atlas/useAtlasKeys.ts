"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

function isEditable(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

/**
 * The Atlas's keyboard: Esc goes one level up (never at the sky). It yields, in order, to an
 * open modal, to a focused field (blurred first, like the kit's keys), and to keys pressed
 * outside the surface. No bare letters: the workspace owns `g` chords. The sky's own arrows
 * live on the sky (AtlasSky), where a mark has focus.
 */
export function useAtlasKeys(rootRef: RefObject<HTMLElement | null>, handlers: { level: number; onBack: () => void; blocked?: boolean }): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isAnyModalOpen()) return;
      const root = rootRef.current;
      if (!root) return;
      const t = e.target;
      const inside = t instanceof Node && root.contains(t);
      if (!inside && t !== document.body) return;
      const { level, onBack, blocked } = ref.current;
      if (level === 0 || blocked) return;
      if (isEditable(t)) {
        e.preventDefault();
        t.blur();
        return;
      }
      e.preventDefault();
      onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
}
