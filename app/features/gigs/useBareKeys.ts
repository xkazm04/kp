"use client";

import { useEffect, useRef } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";
import { isTypingTarget } from "./gigsLogic";

// Bare-key shortcuts for the Gigs desk (J/K through the queue, 1-6 on the checklist),
// with the guards the shell's own shortcuts use: never while typing in a field, never
// under a modal, never with a modifier - and never as the second key of a `g` chord
// (`g j` is the shell's jump to Roles, not "next item"). The shell's chord window is
// 1.5s (WorkspaceKeyboardShortcuts.tsx); a key inside it after a bare `g` is left alone.

const CHORD_WINDOW_MS = 1500;

/** `handler` answers true when it consumed the key. */
export function useBareKeys(handler: (key: string) => boolean, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isAnyModalOpen()) return;
      const key = e.key.toLowerCase();
      if (key === "g" && !e.shiftKey) {
        lastG = Date.now();
        return;
      }
      if (lastG && Date.now() - lastG < CHORD_WINDOW_MS) {
        lastG = 0;
        return;
      }
      lastG = 0;
      if (ref.current(key)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
