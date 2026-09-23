"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { CORAL, CREAM, DISPLAY, HAND, LIMEWASH, STEEL } from "./tokens";
import { PREVIEWS, type PreviewKey } from "./previews";
import { previewPosition } from "./previews/order";
import { useStillMotion } from "./useStillMotion";

/*
 * The spotlight modal that frames a feature preview.
 *
 * Hovering a feature card opens it; a click/tap (or Enter) pins it, so touch
 * and keyboard users get the same show. Content remounts per preview, so every
 * entrance replays on each peek.
 *
 * TWO surfaces, not one with a conditional attribute. The panel used to carry
 * `role="dialog" aria-modal={pinned}` in both states, so the hover peek — a
 * `pointer-events-none` layer the pointer cannot reach and Tab never enters —
 * announced itself to a screen reader as a dialog, and the PINNED one was a
 * dialog in name only: no focus move in, no Tab trap, no restore on close. So:
 *
 *   - hover/focus peek  → SpotlightPeek: decorative, `aria-hidden`, no role.
 *     The card that opened it already carries the same title and body, and its
 *     `aria-expanded` says the peek is showing; re-announcing the copy from an
 *     unreachable layer is noise.
 *   - pinned            → SpotlightDialog: a real dialog wired through the
 *     app's shared `useDialogA11y` (focus in on mount, Tab cycles inside,
 *     Escape closes, focus restored to the card). It mounts only when pinned,
 *     which is exactly the lifecycle that hook's contract needs.
 *
 * The pinned dialog is also a WALK: prev/next buttons (and ArrowLeft/ArrowRight,
 * handled in SparkLanding, which owns the state) step through all nine
 * previews in grid order with a "3 of 9" line, and SparkLanding mirrors the
 * pinned preview into the URL as `/#spotlight-<key>` (./previews/order.ts).
 * Stepping swaps the preview INSIDE the mounted dialog - the dialog does not
 * remount, so focus stays on the button that was pressed and Escape still
 * returns it to the card that opened the dialog. The controls sit after the
 * body so the close button stays the dialog's first focus target. The peek
 * gets none of this: it stays aria-hidden, control-free chrome.
 *
 * Split out of the old FeaturePreviews.tsx, which held this chrome and all nine
 * mockups in one 615-line file. The mockups now live in ./previews/.
 */
export type { PreviewKey };

/** The panel's round sticker buttons: close, prev, next. */
const NAV_BTN =
  "grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#17202a] bg-white shadow-[2px_2px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#17202a]";

/** The sticker panel itself — identical art in both states. */
function SpotlightPanel({
  preview,
  onClose,
  onStep,
  panelRef,
  dialog
}: {
  preview: PreviewKey;
  onClose: () => void;
  onStep?: (dir: 1 | -1) => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  dialog: boolean;
}) {
  const reduceMotion = useStillMotion();
  const t = useTranslations("landing");
  const def = PREVIEWS[preview];
  return (
    <motion.div
      ref={panelRef}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.65, rotate: -5, y: 48 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -1, y: 0 }}
      transition={{ type: "spring", bounce: 0.42, duration: 0.55 }}
      // Only the pinned surface is a dialog; the peek is decorative chrome.
      {...(dialog
        ? { role: "dialog" as const, "aria-modal": true, "aria-label": t(`features.${preview}.title`), tabIndex: -1 }
        : {})}
      className="relative w-full max-w-2xl rounded-2xl border-[3px] border-[#17202a] p-6 shadow-[10px_10px_0_#17202a] outline-none sm:p-7"
      style={{ background: CREAM }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b-[3px] border-dashed pb-4"
        style={{ borderColor: LIMEWASH }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border-[3px] border-[#17202a] bg-white shadow-[3px_3px_0_#17202a]">
            <def.icon className="h-5 w-5" style={{ color: CORAL }} />
          </span>
          <h3 className={`${DISPLAY} text-xl font-bold`}>{t(`features.${preview}.title`)}</h3>
        </div>
        {dialog && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("previews.close")}
            className={NAV_BTN}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {/* Keyed remount → every peek replays the choreography. */}
      <div className="pt-5" key={preview}>
        <def.Body />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {dialog && onStep && <SpotlightNav preview={preview} onStep={onStep} />}
        <p className={`${HAND} ml-auto rotate-1 text-right text-base`} style={{ color: STEEL }}>
          {t(`previews.${preview}.note`)}
        </p>
      </div>
    </motion.div>
  );
}

/** Prev / "3 of 9" / next - dialog only. The position is a polite live region
 *  carrying the (visually redundant) title too, so a screen-reader user hears
 *  WHICH preview a step landed on, not just a number. */
function SpotlightNav({ preview, onStep }: { preview: PreviewKey; onStep: (dir: 1 | -1) => void }) {
  const t = useTranslations("landing");
  const { n, total } = previewPosition(preview);
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onStep(-1)} aria-label={t("previews.prev")} className={NAV_BTN}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <p aria-live="polite" aria-atomic="true" className={`${DISPLAY} min-w-[4.5rem] text-center text-sm font-bold tabular-nums`}>
        <span className="sr-only">{t(`features.${preview}.title`)}, </span>
        {t("previews.position", { n, total })}
      </p>
      <button type="button" onClick={() => onStep(1)} aria-label={t("previews.next")} className={NAV_BTN}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** Pinned: a real modal dialog. Mounts on pin, unmounts on close — so
 *  useDialogA11y's mount-scoped focus move / trap / restore lines up with it. */
function SpotlightDialog({
  preview,
  onClose,
  onStep
}: {
  preview: PreviewKey;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogA11y(panelRef, onClose, { trap: true, lockScroll: true });
  return (
    <>
      <div className="absolute inset-0 bg-[#17202a]/45" onClick={onClose} aria-hidden />
      <SpotlightPanel preview={preview} onClose={onClose} onStep={onStep} panelRef={panelRef} dialog />
    </>
  );
}

/** Hover/focus peek: unreachable by pointer and keyboard, so hidden from the
 *  accessibility tree rather than announced as something you can act on. */
function SpotlightPeek({ preview }: { preview: PreviewKey }) {
  return (
    <div aria-hidden className="contents">
      <div className="absolute inset-0 bg-[#17202a]/45" />
      <SpotlightPanel preview={preview} onClose={() => {}} dialog={false} />
    </div>
  );
}

export function FeatureSpotlight({
  preview,
  pinned,
  onClose,
  onStep
}: {
  preview: PreviewKey | null;
  pinned: boolean;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <AnimatePresence>
      {preview && (
        <motion.div
          // Keyed by state as well as identity: pinning must REMOUNT the panel
          // so the dialog's focus machinery runs, and so the peek's aria-hidden
          // layer is gone rather than re-labelled.
          key={pinned ? "spotlight-pinned" : "spotlight-peek"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={`fixed inset-0 z-[60] grid place-items-center p-4 sm:p-8 ${pinned ? "" : "pointer-events-none"}`}
        >
          {pinned ? (
            <SpotlightDialog preview={preview} onClose={onClose} onStep={onStep} />
          ) : (
            <SpotlightPeek preview={preview} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
