"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check, FileText, Stamp } from "lucide-react";
import { DISPLAY, HAND } from "../tokens";
import { ENTER } from "./shared";

/* 06 · Offer — deterministic figure, auto-drafted, human-approved, accepted. */
// Illustrative figure, not copy; only its currency label localises.
const FIGURE = "150k";
export default function OfferArt({ color = "#caa54c" }: { color?: string }) {
  const t = useTranslations("aboutPage");
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center justify-between border-b-[3px] border-dashed border-[#dce7d0] pb-3">
        <p className={`${HAND} text-lg text-[#526b4f]`}>{t("art.offer.letter")}</p>
        <FileText className="h-5 w-5 text-[#42606f]" aria-hidden />
      </div>
      <div className="mt-4 text-center">
        <motion.p
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={ENTER}
          transition={{ type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} text-4xl font-extrabold`}
        >
          {FIGURE} <span className="text-base text-[#42606f]">{t("art.offer.currency")}</span>
        </motion.p>
        <p className="text-sm font-bold text-[#42606f]">{t("art.offer.formula")}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <motion.span
          initial={{ scale: 2, opacity: 0, rotate: 12 }}
          whileInView={{ scale: 1, opacity: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
          className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] px-3 py-1 text-sm font-extrabold uppercase text-white shadow-[2px_2px_0_#17202a]"
          style={{ background: color }}
        >
          <Stamp className="h-3.5 w-3.5" aria-hidden /> {t("art.offer.humanApproved")}
        </motion.span>
        <motion.span
          initial={{ opacity: 0, x: 16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={ENTER}
          transition={{ delay: 0.6, type: "spring", bounce: 0.4 }}
          className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-[#526b4f] px-3 py-1 text-sm font-bold text-white shadow-[2px_2px_0_#17202a]"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> {t("art.offer.accepted")}
        </motion.span>
      </div>
    </div>
  );
}
