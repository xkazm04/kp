"use client";

// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #4) — one shared
// dismissal primitive for the schedule popovers (AddToCalendar's menu and
// MeetingLinkCell's editor), replacing two hand-rolled copies that each dismissed
// via a `fixed inset-0 z-40` invisible <button> covering the whole viewport. That
// blanket swallowed a mouse user's FIRST outside click (it only closed the popover
// instead of activating whatever they clicked — a two-click trap) and offered no
// Escape-to-close or focus-return for keyboard/AT users.
//
// This handles both: a document `pointerdown` listener closes on an outside press
// WITHOUT eating that press (the same click still activates its target), plus an
// Escape handler that closes and returns focus to the trigger.

import { useEffect, useRef, type RefObject } from "react";

/** Keys that dismiss a popover. Pure + exported so it's unit-testable without a DOM. */
export function isDismissKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}

export function usePopoverDismiss<T extends HTMLElement = HTMLElement>(opts: {
  open: boolean;
  onClose: () => void;
  /** Focus returns here on Escape so a keyboard user isn't dropped at the page top. */
  triggerRef?: RefObject<HTMLElement | null>;
}): RefObject<T | null> {
  const { open, onClose, triggerRef } = opts;
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (isDismissKey(e.key)) {
        onClose();
        triggerRef?.current?.focus();
      }
    };
    const onPointer = (e: Event) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Capture-phase pointerdown: fires before the click reaches its target, so we
    // close the popover yet let that very click activate the control the user hit.
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, onClose, triggerRef]);

  return containerRef;
}
