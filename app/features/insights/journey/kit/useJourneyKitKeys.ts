"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Typing in a field or an editable region never steps the list. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * The lane board's keys. KitSurface's own j/k/Esc (useKitKeys) stand down whenever a dialog is open
 * (isAnyModalOpen), and this board LIVES in one, the Journeys overlay, so it answers them itself:
 *
 *   j / k   move the cursor through the lanes (the open pane follows it)
 *   Enter   open the pane on the cursor (not when focus sits on a button, which presses it)
 *   Esc     close the pane first; only a second Esc reaches the overlay and closes the board
 *
 * ← / → walk the rail's steps (JourneyKitLanes, on the rail itself). Scoped to keys whose target is
 * inside `root`'s dialog (or on <body> while it is the topmost modal), so a modal opened over the
 * board keeps its own keys. The shell's `g`
 * chords are already inert under any dialog (WorkspaceKeyboardShortcuts), so nothing collides.
 */
export function useJourneyKitKeys(
  root: RefObject<HTMLElement | null>,
  handlers: { step: (d: 1 | -1) => void; open: () => void; close: () => void; paneOpen: boolean }
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    // A pressed row is a div, so after a click the key's target is <body>: that still counts, as
    // long as this board's dialog is the topmost modal (the last one mounted).
    const inBoard = (e: KeyboardEvent) => {
      const dialog = root.current?.closest("[role='dialog']");
      if (!dialog || !(e.target instanceof Node)) return false;
      const top = Array.from(document.querySelectorAll("[aria-modal='true']")).at(-1);
      return top === dialog && (e.target === document.body || dialog.contains(e.target));
    };
    // Capture, so the pane's Esc runs before the overlay's document-level Escape (useDialogA11y)
    // and stops it: one Esc closes one thing.
    const onCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !ref.current.paneOpen || !inBoard(e) || isEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isEditable(e.target) || !inBoard(e)) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        ref.current.step(e.key === "j" ? 1 : -1);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target as HTMLElement).closest?.("[role='button']")) {
        e.preventDefault();
        ref.current.open();
      }
    };
    document.addEventListener("keydown", onCapture, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [root]);
}
