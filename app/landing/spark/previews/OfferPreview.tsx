"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, MOSS, STEEL } from "../tokens";
import { ROW } from "./shared";

/* 09 · Offer to onboarded — the last mile. */
const STEPS = [
  { key: "figure", done: true },
  { key: "letter", done: true },
  { key: "accepted", done: true },
  { key: "onboarding", done: false }
] as const;

export default function OfferPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  return (
    <div>
      <p className="text-[17px] font-bold">{t("previews.offer.title", { name: "Petr K." })}</p>
      <div className="mt-4 space-y-2.5">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28 + i * 0.13, type: "spring", bounce: 0.4 }}
            className={`${ROW} flex items-center gap-3 p-3`}
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
              style={{ background: s.done ? MOSS : AMBER }}
              aria-hidden
            >
              <Check className="h-3.5 w-3.5 text-white" />
            </span>
            <div>
              <p className="text-[17px] font-bold">{t(`previews.offer.steps.${s.key}.label`)}</p>
              <p className="text-sm" style={{ color: STEEL }}>
                {t(`previews.offer.steps.${s.key}.detail`)}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
