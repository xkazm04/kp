"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A centered, focus-trapped dialog: backdrop-click + Escape close, Tab cycles
// within, focus restores to the trigger on unmount. Rendered through a portal to
// document.body so it always covers the whole viewport — escaping any ancestor
// that establishes a containing block for `fixed` (e.g. the tab wrapper's
// transform-based fade-in animation), which otherwise pinned it to tab content.
const SIZE: Record<string, string> = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "3xl": "max-w-3xl", "4xl": "max-w-4xl", full: "max-w-[1600px]" };

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
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const node = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
            (el) => !el.hasAttribute("disabled")
          )
        : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
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
        aria-labelledby="modal-title"
        className={`animate-fade-in relative flex w-full ${isFull ? "h-[92vh] max-h-[92vh]" : "max-h-[85vh]"} ${SIZE[size] ?? SIZE["2xl"]} flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl`}
      >
        <header className="flex items-start gap-3 border-b border-stone-200 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id="modal-title" className="truncate font-serif text-h3 text-ink">
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
