"use client";

import { useEffect, useRef } from "react";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

/**
 * `/` focuses the pipeline search (the retired filter bar's shortcut): bare key only, never while a
 * field or an editable region has focus and never under a dialog. Returns the ref for the element
 * that wraps the search field.
 */
export function useSlashSearch() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (isAnyModalOpen()) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const input = ref.current?.querySelector("input");
      if (!input) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}
