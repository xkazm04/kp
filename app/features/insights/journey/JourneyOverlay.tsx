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
//
// Two LEVELS, one overlay. It opens on the cohort layer - every journey in the
// workspace on one derived path, coverage and failures per stage - and the reader
// descends into the board for one role (or all of them) from there. The header
// always says which level is showing and how to go back up.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useKitFlag } from "@/app/_components/kit/useKitFlag";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { Button } from "@/app/_components/kit/Button";
import { PageHead } from "@/app/_components/kit/PageHead";
import { JourneyBoardView } from "./JourneyBoardView";
import { JourneyCohortView } from "./cohort/JourneyCohortView";
import "./journeyBoard.css";

type Level = { kind: "cohort" } | { kind: "board"; role: string | null };

// Gate 3 (kit-unification spark, dev only): `?kit=1` renders the board level as the composition
// kit's lane board, and the overlay opens on it (its Roles section is the role switch; the cohort
// layer stays one "back" away). Its code and CSS load only behind the flag (a dynamic chunk);
// production always renders the Broadsheet below.
const JourneyKitView = dynamic(() => import("./kit/JourneyKitView"), {
  loading: () => <LoadingGap className="m-5 min-h-[28rem]" />,
});

export function JourneyOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const t = useTranslations("journey");
  const kit = useKitFlag();
  // null = not moved yet: the Broadsheet opens on the cohort, the kit lane board on itself.
  const [moved, setLevel] = useState<Level | null>(null);
  const level: Level = moved ?? (kit ? { kind: "board", role: null } : { kind: "cohort" });
  useDialogA11y(ref, onClose, { trap: true, lockScroll: true });

  // PORTALED TO document.body, and it has to be. The tab panel that renders this
  // carries `.animate-tab-in`, whose keyframes animate `transform` with fill mode
  // `both` — so the element keeps a transform forever, and a transformed ancestor
  // becomes the CONTAINING BLOCK for `position: fixed` descendants. Rendered in
  // place, `fixed inset-0` resolved against that panel instead of the viewport and
  // the overlay measured 1264x0: present in the DOM, correct in the a11y tree,
  // and zero pixels tall. Same portal idiom as app/_components/Modal.tsx.
  if (typeof document === "undefined") return null;

  return createPortal(
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
        {/* The kit's page head (the same eyebrow, display title, context line and
            action track as Pipeline and Channels), shared by both levels. */}
        <div className="k-kit jr-head shrink-0" data-density="compact">
          <PageHead
            eyebrow={level.kind === "cohort" ? t("cohort.eyebrow") : t("phases.screening")}
            title={t("title")}
            context={level.kind === "cohort" ? t("cohort.lede") : t("lede")}
            actions={
              <>
                {level.kind === "board" ? (
                  <Button
                    label={t("cohort.back")}
                    icon="left"
                    variant="ghost"
                    onClick={() => setLevel({ kind: "cohort" })}
                    data-testid="journey-back-to-cohort"
                  />
                ) : null}
                <Button label={t("closeBoard")} icon="x" iconOnly variant="ghost" onClick={onClose} />
              </>
            }
          />
        </div>

        {/* The board owns its own scrolling in both axes — the overlay is the
            viewport, so nothing here may introduce a second page-level scroll. */}
        {level.kind === "cohort" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <JourneyCohortView onOpenBoard={(role) => setLevel({ kind: "board", role })} />
          </div>
        ) : (
          kit ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <JourneyKitView initialRole={level.role} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">
              <JourneyBoardView initialRole={level.role ?? undefined} />
            </div>
          )
        )}
      </div>
    </>,
    document.body
  );
}
