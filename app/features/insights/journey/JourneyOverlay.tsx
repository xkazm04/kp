"use client";

// The Journeys surface: a FULL-VIEWPORT overlay above the workspace, not a panel
// inside the content frame.
//
// Why an overlay. Every other tab renders inside Workspace's `max-w-[108rem]`
// container. This board puts dozens of candidate journeys side by side with a
// canonical step rail down the left, and it needs the whole window — width AND
// height — to be readable. The shape is the one `OverlayShell` already
// established for the Orchard (scrim at z-40, dialog surface at z-50, focus
// trapped, Escape closes, body scroll locked); this module reuses the same a11y
// primitive rather than a second dialog implementation.
//
// Closing returns to the tab the reader came from — Workspace owns that memory
// and hands it down as `onClose`, so the reader never lands on an empty frame.

import { useRef } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_GHOST, EYEBROW, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { JourneyBoardView } from "./JourneyBoardView";

export function JourneyOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const t = useTranslations("journey");
  useDialogA11y(ref, onClose, { trap: true, lockScroll: true });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim" aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-paper focus:outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 px-5 py-3">
          <div className="min-w-0">
            <p className={EYEBROW}>{t("phases.screening")}</p>
            <h1 className={TITLE_DISPLAY}>{t("title")}</h1>
            <p className="mt-0.5 text-sm text-stone-500">{t("lede")}</p>
          </div>
          <button type="button" onClick={onClose} className={`${BTN_GHOST} p-2`} aria-label={t("closeBoard")}>
            <X size={18} aria-hidden />
          </button>
        </header>

        {/* The board owns its own scrolling in both axes — the overlay is the
            viewport, so nothing here may introduce a second page-level scroll. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <JourneyBoardView />
        </div>
      </div>
    </>
  );
}
