"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { CORAL, CREAM, DISPLAY, HAND, LIMEWASH, STEEL } from "./tokens";
import { PREVIEWS, type PreviewKey } from "./previews";

/*
 * The spotlight modal that frames a feature preview.
 *
 * Hovering a feature card opens it; a click/tap (or Enter) pins it, so touch
 * and keyboard users get the same show. Content remounts per preview, so every
 * entrance replays on each peek.
 *
 * Split out of the old FeaturePreviews.tsx, which held this chrome and all nine
 * mockups in one 615-line file. The mockups now live in ./previews/.
 */
export type { PreviewKey };

export function FeatureSpotlight({
  preview,
  pinned,
  onClose
}: {
  preview: PreviewKey | null;
  pinned: boolean;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const t = useTranslations("landing");
  const def = preview ? PREVIEWS[preview] : null;

  return (
    <AnimatePresence>
      {def && preview && (
        <motion.div
          key="spotlight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={`fixed inset-0 z-[60] grid place-items-center p-4 sm:p-8 ${pinned ? "" : "pointer-events-none"}`}
        >
          <div className="absolute inset-0 bg-[#17202a]/45" onClick={pinned ? onClose : undefined} aria-hidden />
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.65, rotate: -5, y: 48 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -1, y: 0 }}
            transition={{ type: "spring", bounce: 0.42, duration: 0.55 }}
            role="dialog"
            aria-modal={pinned}
            aria-label={t(`features.${preview}.title`)}
            className="relative w-full max-w-2xl rounded-2xl border-[3px] border-[#17202a] p-6 shadow-[10px_10px_0_#17202a] sm:p-7"
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
              {pinned && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("previews.close")}
                  className="grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#17202a] bg-white shadow-[2px_2px_0_#17202a] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#17202a]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            {/* Keyed remount → every peek replays the choreography. */}
            <div className="pt-5" key={preview}>
              <def.Body />
            </div>
            <p className={`${HAND} mt-5 rotate-1 text-right text-base`} style={{ color: STEEL }}>
              {t(`previews.${preview}.note`)}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
