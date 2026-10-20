"use client";

import { useEffect, useRef } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

/** Typing in a field, a select or an editable region never steps the list. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * A kit surface's keyboard (kit.js keydown): j / k step the selection through the list, Esc
 * closes the reading pane. Bare keys only (no Ctrl/Meta/Alt), never while a field has focus or
 * a modal is open. The variant's `G` (show the measure) is NOT ported: kp's workspace owns `g`
 * as the prefix of its two-key tab chords (WorkspaceKeyboardShortcuts.tsx).
 */
export function useKitKeys(handlers: { onStep?: (delta: 1 | -1) => void; onClose?: () => void }): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isEditable(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLElement) e.target.blur();
        return;
      }
      if (isAnyModalOpen()) return;
      const { onStep, onClose } = ref.current;
      if ((e.key === "j" || e.key === "k") && onStep) {
        e.preventDefault();
        onStep(e.key === "j" ? 1 : -1);
      } else if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
