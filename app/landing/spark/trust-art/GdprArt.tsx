"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Eye, RotateCcw, Trash2, UserCheck } from "lucide-react";
import { CORAL, HAND, INK, LIMEWASH, MOSS, STEEL } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { CARD, ENTER, PILL } from "./shared";

/*
 * 03 · GDPR & Article 22 — consent first, and the erase button really works.
 *
 * Two claims, drawn in order. The record sits behind a closed gate until a
 * consent stamp lands on it: no AI reads anything before that, and the drawing
 * refuses to let the reader see the fields either. Then the three rights
 * appear — and `erase` is a live button, because a right you can only read
 * about is exactly the thing candidates have stopped believing. Clicking it
 * shreds the record on screen and leaves a restore, so the panel can be shown
 * twice.
 *
 * `see` and `review` are illustrative chips, not controls: there is nothing
 * honest for them to do inside a mockup, and a button that pretends to file a
 * human-review request would be the one dishonest pixel on the page.
 */
const FIELDS = ["name", "email", "cv"] as const;
// Eight strips, because a shred that leaves four fat slabs reads as a broken
// card rather than a destroyed one.
const STRIPS = Array.from({ length: 8 }, (_, i) => i);

export default function GdprArt() {
  const t = useTranslations("landing");
  const rm = useStillMotion();
  const [erased, setErased] = useState(false);

  return (
    <div className="w-full max-w-[500px]">
      <div className="relative mx-auto h-[232px] w-full sm:h-[188px]">
        <AnimatePresence mode="wait">
          {!erased ? (
            <motion.div
              key="record"
              exit={rm ? { opacity: 0 } : { opacity: 0, scaleY: 0.94, transition: { duration: 0.18 } }}
              className={`${CARD} absolute inset-x-0 top-0 p-4`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold">{t("trust.art.gdpr.cardTitle")}</p>
                  <p className="text-xs font-bold" style={{ color: STEEL }}>
                    {t("trust.art.gdpr.cardMeta")}
                  </p>
                </div>
                {/* The consent stamp — nothing below it is legible until it lands. */}
                <motion.span
                  initial={rm ? false : { opacity: 0, scale: 2.1, rotate: 12 }}
                  whileInView={{ opacity: 1, scale: 1, rotate: -6 }}
                  viewport={ENTER}
                  transition={{ delay: 0.45, type: "spring", bounce: 0.5 }}
                  className="whitespace-nowrap rounded-full border-[3px] border-[#17202a] px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-white shadow-[2px_2px_0_#17202a]"
                  style={{ background: MOSS }}
                >
                  {t("trust.art.gdpr.consent")}
                </motion.span>
              </div>

              <div className="mt-3 space-y-2">
                {FIELDS.map((f, i) => (
                  <div key={f} className="flex items-center gap-2.5">
                    <span className="w-14 shrink-0 text-xs font-bold" style={{ color: STEEL }}>
                      {t(`trust.art.gdpr.fields.${f}`)}
                    </span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded-full" style={{ background: LIMEWASH }}>
                      {/* Redaction lifts field by field once consent is given. */}
                      <motion.span
                        className="absolute inset-y-0 right-0 rounded-full"
                        style={{ background: INK }}
                        initial={rm ? false : { width: "100%" }}
                        whileInView={{ width: "0%" }}
                        viewport={ENTER}
                        transition={{ delay: 0.7 + i * 0.14, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </span>
                  </div>
                ))}
              </div>

              <motion.p
                initial={rm ? false : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={ENTER}
                transition={{ delay: 1.2 }}
                className={`${HAND} mt-3 text-sm`}
                style={{ color: MOSS }}
              >
                {t("trust.art.gdpr.consentNote")}
              </motion.p>
            </motion.div>
          ) : (
            <motion.div key="shredded" className="absolute inset-x-0 top-0 h-[150px]">
              {STRIPS.map((s) => (
                <motion.span
                  key={s}
                  aria-hidden
                  className="absolute top-0 h-full rounded-sm border-[3px] border-[#17202a] bg-white"
                  style={{ left: `${s * 12.5}%`, width: "11%" }}
                  initial={{ y: 0, opacity: 1, rotate: 0 }}
                  animate={rm ? { opacity: 0 } : { y: 150, opacity: 0, rotate: s % 2 ? 12 : -12 }}
                  transition={{ delay: s * 0.045, duration: 0.75, ease: "easeIn" }}
                />
              ))}
              <motion.span
                initial={rm ? false : { opacity: 0, scale: 2.2, rotate: 12 }}
                animate={{ opacity: 1, scale: 1, rotate: -7 }}
                transition={{ delay: 0.5, type: "spring", bounce: 0.5 }}
                className="absolute left-1/2 top-12 grid h-24 w-24 -translate-x-1/2 place-items-center rounded-full border-[4px] border-[#17202a] text-center text-xs font-extrabold uppercase leading-tight tracking-wide text-white shadow-[4px_4px_0_#17202a]"
                style={{ background: CORAL }}
              >
                {t("trust.art.gdpr.erased")}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={PILL}>
          <Eye className="h-3.5 w-3.5" style={{ color: STEEL }} aria-hidden />
          {t("trust.art.gdpr.rights.see")}
        </span>
        <span className={PILL}>
          <UserCheck className="h-3.5 w-3.5" style={{ color: STEEL }} aria-hidden />
          {t("trust.art.gdpr.rights.review")}
        </span>
        <button
          type="button"
          onClick={() => setErased((e) => !e)}
          className={`${PILL} focus-ring transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_#17202a]`}
          style={erased ? undefined : { background: CORAL, color: "#fff" }}
        >
          {erased ? (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {erased ? t("trust.art.gdpr.restore") : t("trust.art.gdpr.rights.erase")}
        </button>
      </div>
    </div>
  );
}
