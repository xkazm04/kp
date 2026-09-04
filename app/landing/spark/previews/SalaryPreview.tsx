"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, CORAL, DISPLAY, INK, LIMEWASH, MOSS, STEEL } from "../tokens";
import { PreviewNote, entrance, pop } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 05 · Salary radar — the needle finds the market. */
// Axis and marker figures are illustrative data, not copy — named here so they
// read as data and stay out of the message catalog.
const AXIS = { low: "60k", high: "120k", marker: "95k" } as const;
const CHIPS = [
  { key: "band", color: MOSS },
  { key: "median", color: CORAL },
  { key: "modifier", color: AMBER }
] as const;

export default function SalaryPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm font-bold" style={{ color: STEEL }}>
        <span>{t("previews.salary.role")}</span>
        <span className="nums">{t("previews.salary.unit")}</span>
      </div>
      <div className="relative mt-8">
        <div className="h-4 rounded-full border-[3px] border-[#17202a] bg-white" />
        <motion.div
          className="absolute inset-y-[3px] rounded-full"
          style={{ background: LIMEWASH, left: "3px", right: "3px" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={entrance(reduce, { delay: 0.1 })}
        />
        <motion.div
          className="absolute inset-y-[3px] rounded-full"
          style={{ background: MOSS, left: "41%" }}
          initial={{ width: 0 }}
          animate={{ width: "34%" }}
          transition={entrance(reduce, { delay: 0.35, type: "spring", bounce: 0.25 })}
        />
        <motion.span
          initial={{ left: "8%", opacity: 0 }}
          animate={{ left: "58%", opacity: 1 }}
          transition={entrance(reduce, { delay: 0.7, type: "spring", bounce: 0.55 })}
          className="absolute -top-7 -translate-x-1/2"
        >
          {/* Axis figures are illustrative data, not copy. */}
          <span
            className={`${DISPLAY} nums rounded-lg border-[3px] border-[#17202a] px-2 py-0.5 text-[17px] font-extrabold text-white shadow-[2px_2px_0_#17202a]`}
            style={{ background: CORAL }}
          >
            {AXIS.marker}
          </span>
          <span className="mx-auto mt-0.5 block h-3 w-1 rounded-full" style={{ background: INK }} aria-hidden />
        </motion.span>
        <div className="nums mt-2 flex justify-between text-sm font-bold" style={{ color: STEEL }}>
          <span>{AXIS.low}</span>
          <span>{AXIS.high}</span>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2.5">
        {CHIPS.map((chip, i) => (
          <motion.span
            key={chip.key}
            {...pop(0.9 + i * 0.12, reduce)}
            className="rounded-full border-[3px] border-[#17202a] px-3.5 py-1.5 text-sm font-bold text-white shadow-[2px_2px_0_#17202a]"
            style={{ background: chip.color }}
          >
            {t(`previews.salary.chips.${chip.key}`)}
          </motion.span>
        ))}
      </div>
      <PreviewNote delay={1.35} color={STEEL}>
        {t("previews.salary.grounded")}
      </PreviewNote>
    </div>
  );
}
