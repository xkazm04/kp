"use client";

import { useEffect, useRef } from "react";

// Shared dialog/drawer accessibility machinery, extracted from Modal so the side
// drawers (CandidateDrawer, PipelineExplorer, SimExplainDrawer) and the centered
// Modal all share ONE focus/escape/scroll-lock implementation — and, crucially, ONE
// stack. Without a shared stack, a modal opened over a drawer (or two drawers) would
// each think it is "top", so Escape/Tab would fire for the wrong one and the global
// keyboard shortcuts couldn't tell anything was open.

// Mount-order stack of every open dialog/drawer. The keydown handler lives on
// `document` (so Escape works even when focus sits on the container or <body>), so
// every open dialog's listener fires for one keypress — gating on "am I the top of
// the stack?" keeps Escape/Tab acting only on the frontmost one.
const dialogStack: symbol[] = [];
function isTop(token: symbol): boolean {
  return dialogStack[dialogStack.length - 1] === token;
}

/** SHELL4 — whether ANY dialog/drawer is currently open. The global keyboard
 *  shortcuts consult this so a bare keypress can't switch tabs underneath an open
 *  dialog (whose own Escape/Tab handling stays authoritative). */
export function isAnyModalOpen(): boolean {
  return dialogStack.length > 0;
}

// Ref-counted body-scroll lock shared across all mounted modals: only the first
// mount hides body overflow (saving the prior value) and only the last unmount
// restores it, so closing a stacked dialog never prematurely unlocks scroll behind
// the one still open. Non-modal drawers opt out (lockScroll: false).
let scrollLockCount = 0;
let prevBodyOverflow = "";
function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}
function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = prevBodyOverflow;
}

/**
 * Wire WCAG dialog behavior onto a dialog/drawer element:
 *  - move focus inside on open (first focusable, else the container) and restore it
 *    to the trigger on close,
 *  - close on Escape (document-level, gated to the top of the stack),
 *  - when `trap` (modal): cycle Tab within the dialog,
 *  - when `lockScroll` (modal): ref-counted body-scroll lock,
 *  - register on the shared stack so isAnyModalOpen()/top-gating see it.
 *
 * `trap`/`lockScroll` default to true (the modal contract). A deliberately NON-modal
 * panel that keeps the page interactive (e.g. the half-page explorer drawer) passes
 * `{ trap: false, lockScroll: false }`: it still gets focus-in/out + Escape, but never
 * traps Tab or locks the page.
 *
 * The element must be programmatically focusable (`tabIndex={-1}`) so a content-only
 * dialog still has a guaranteed first focus target.
 */
export function useDialogA11y(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { trap?: boolean; lockScroll?: boolean } = {}
): void {
  const { trap = true, lockScroll = true } = opts;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const token = Symbol("dialog");
    dialogStack.push(token);
    if (lockScroll) lockBodyScroll();

    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          ).filter(
            // Exclude aria-disabled controls too, not just `disabled`: an aria-disabled
            // button is still tabbable, so counting it as a trap boundary would land
            // focus on a control the user can't act on.
            (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true"
          )
        : [];
    (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (!isTop(token)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!trap || e.key !== "Tab" || !node) return;
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === node)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = dialogStack.indexOf(token);
      if (i !== -1) dialogStack.splice(i, 1);
      if (lockScroll) unlockBodyScroll();
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
