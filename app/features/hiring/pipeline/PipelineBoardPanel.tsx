"use client";

// The board panel — the filter header, its modes and the Subway board as ONE section —
// inline on the tab, or opened on the FULL PAGE to explore a wide board.
//
// Full page is a portal to <body> at z-40, not a class on the inline section: the
// tab sits inside framer-motion wrappers whose transforms would become the containing
// block of a `fixed` element and pin it to the tab instead of the viewport. At z-40 it
// covers the shell, and the board's own overlays (the Orchard, the candidate modal,
// the shared Modal — all z-50 portals) still paint above it. Body scroll is locked
// while it is open, and Escape returns it to the tab — unless a dialog is open, whose
// own Escape wins.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PANEL } from "@/app/_components/ui/recipes";
import { isAnyModalOpen } from "@/app/_components/useDialogA11y";

const noSubscription = () => () => undefined;

export function PipelineBoardPanel({
  expanded,
  onCollapse,
  label,
  children,
}: {
  expanded: boolean;
  onCollapse: () => void;
  /** The full-page section's accessible name. */
  label: string;
  children: ReactNode;
}) {
  const portalRoot = useSyncExternalStore(noSubscription, () => document.body, () => null);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isAnyModalOpen()) onCollapse();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, onCollapse]);

  if (expanded && portalRoot) {
    return createPortal(
      <section aria-label={label} className="fixed inset-0 z-40 flex flex-col overflow-auto bg-white">
        {children}
      </section>,
      portalRoot,
    );
  }
  return <section className={`${PANEL} overflow-hidden`}>{children}</section>;
}
