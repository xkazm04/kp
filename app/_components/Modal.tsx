"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogA11y } from "./useDialogA11y";

// SHELL4 — re-exported here for back-compat: callers historically import
// isAnyModalOpen from Modal. The implementation (and the shared stack it reads) now
// lives in useDialogA11y, so drawers that use the hook count toward it too.
export { isAnyModalOpen } from "./useDialogA11y";

// A centered, focus-trapped dialog: backdrop-click + Escape close, Tab cycles
// within, focus restores to the trigger on unmount. Rendered through a portal to
// document.body so it always covers the whole viewport — escaping any ancestor
// that establishes a containing block for `fixed` (e.g. the tab wrapper's
// transform-based fade-in animation), which otherwise pinned it to tab content.
// The focus-trap / scroll-lock / Escape-stack machinery is the shared useDialogA11y
// hook, so the side drawers share the exact same implementation + stack.
// Widths are 20% larger than the Tailwind max-w-* scale they map from (md 28→33.6,
// lg 32→38.4, xl 36→43.2, 2xl 42→50.4, 3xl 48→57.6, 4xl 56→67.2rem; full 1600→1920px)
// — a deliberate roomier dialog, so they're arbitrary values rather than the named
// classes.
const SIZE: Record<string, string> = { md: "max-w-[33.6rem]", lg: "max-w-[38.4rem]", xl: "max-w-[43.2rem]", "2xl": "max-w-[50.4rem]", "3xl": "max-w-[57.6rem]", "4xl": "max-w-[67.2rem]", full: "max-w-[1920px]" };

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
  // Focus-trap + scroll-lock + Escape (top-of-stack gated) + focus restore.
  useDialogA11y(ref, onClose, { trap: true, lockScroll: true });

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
        // dvh, not vh: on iOS Safari vh is the LARGE viewport, so with the URL bar
        // visible a vh-sized centered dialog clips its header and footer off-screen.
        className={`animate-fade-in relative flex w-full ${isFull ? "h-[92dvh] max-h-[92dvh]" : "max-h-[85dvh]"} ${SIZE[size] ?? SIZE["2xl"]} flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-overlay focus:outline-none`}
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
