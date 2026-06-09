"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A centered, focus-trapped dialog: backdrop-click + Escape close, Tab cycles
// within, focus restores to the trigger on unmount. Rendered through a portal to
// document.body so it always covers the whole viewport — escaping any ancestor
// that establishes a containing block for `fixed` (e.g. the tab wrapper's
// transform-based fade-in animation), which otherwise pinned it to tab content.
const SIZE: Record<string, string> = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "3xl": "max-w-3xl", "4xl": "max-w-4xl", full: "max-w-[1600px]" };

// Ref-counted body-scroll lock shared across all mounted modals. The page behind
// a portalled dialog must not scroll (visible bleed on touch/mobile, and the
// modal itself can scroll off-screen). Stacked dialogs (e.g. a confirm over a
// detail modal) share ONE lock via this counter: only the first mount hides body
// overflow — saving whatever was there — and only the last unmount restores it,
// so closing the top dialog never prematurely unlocks scroll behind the one
// still open.
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

// Mount-order stack of open dialogs. The key handler now lives on `document`
// (so Escape works even when focus sits on the dialog container or <body>),
// which means every open modal's listener fires for one keypress. Gating on
// "am I the top of the stack?" keeps Escape closing only the frontmost dialog
// and Tab trapping only within it — the behavior the old node-bound listener
// got for free from event bubbling through the focused element.
const modalStack: symbol[] = [];
function isTopModal(token: symbol): boolean {
  return modalStack[modalStack.length - 1] === token;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "2xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "full";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Unique per-instance id so stacked dialogs never share id="modal-title" —
  // aria-labelledby resolves to the FIRST match in the DOM, so a hardcoded id
  // made a confirm-over-detail stack announce the wrong dialog's title.
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Lock background scroll while this modal is mounted (ref-counted for stacks).
  useEffect(() => {
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, []);
  useEffect(() => {
    const node = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const token = Symbol("modal");
    modalStack.push(token);
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
            // Exclude aria-disabled controls too, not just `disabled`: an aria-disabled
            // button is still tabbable, so counting it as a trap boundary let Tab land the
            // first/last focus on a control the user can't actually act on.
            (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true"
          )
        : [];
    // Contract: focus always lands inside the dialog so Escape/Tab have an
    // anchor. Prefer the first focusable child; for content-only modals with
    // none, fall back to the dialog container (focusable via tabIndex={-1}) so
    // focus never stays on <body>.
    (focusables()[0] ?? node)?.focus();
    // Listen on document, not the dialog node: a keydown handler bound to the
    // node only fires while focus is inside it, so a content-only modal (focus
    // sitting on the container or escaped to <body>) could never be closed with
    // Escape. document-level listening makes Escape-closes-always hold. Gate on
    // being the top of the modal stack so stacked dialogs each handle their own
    // keys instead of all closing at once.
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = focusables();
      // No focusable children: keep focus pinned to the dialog container so Tab
      // can't escape to the page behind the modal.
      if (!items.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // active === node covers the container-focused fallback above, plus any
      // moment focus has drifted off the trapped children.
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
      const i = modalStack.indexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
      prev?.focus?.();
    };
  }, []);

  // The full-page variant fills the viewport (a near-fullscreen workspace for
  // dense comparisons) rather than sizing to its content like the dialogs.
  const isFull = size === "full";
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isFull ? "p-2 sm:p-4" : "p-4"}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Programmatically focusable (but not in the Tab order) so a content-only
        // modal with no focusable children still has a guaranteed first focus
        // target — keeping focus inside the dialog and the Escape/Tab handler live.
        tabIndex={-1}
        className={`animate-fade-in relative flex w-full ${isFull ? "h-[92vh] max-h-[92vh]" : "max-h-[85vh]"} ${SIZE[size] ?? SIZE["2xl"]} flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl focus:outline-none`}
      >
        <header className="flex items-start gap-3 border-b border-stone-200 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-serif text-h3 text-ink">
              {title}
            </h2>
            {subtitle ? <p className="truncate text-sm text-steel">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-stone-200 px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
