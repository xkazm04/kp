"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, CORAL, HAND, INK, MOSS, STEEL } from "../tokens";
import { ROW, StampChip, entrance, pop } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 06 · Gates & receipts — cards dealt, human signs. */
// Candidate names are fictional sample data and ride in as placeholders, so a
// translator moves them within the sentence instead of rewriting them.
const QUEUE = [
  { key: "advance", name: "Jana N.", color: MOSS },
  { key: "pass", name: "Alex T.", color: CORAL },
  { key: "offer", name: "Petr K.", color: AMBER }
] as const;

export default function GatesPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-bold">{t("previews.gates.waiting", { n: QUEUE.length })}</p>
        <StampChip background={CORAL}>{t("previews.gates.humanGate")}</StampChip>
      </div>
      <div className="mt-4 space-y-3">
        {QUEUE.map((item, i) => (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 26, rotate: i % 2 === 0 ? -3 : 3 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={entrance(reduce, { delay: 0.35 + i * 0.16, type: "spring", bounce: 0.4 })}
            className={`${ROW} p-3.5`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[17px] font-bold">{t(`previews.gates.queue.${item.key}.title`, { name: item.name })}</p>
                <p className="mt-0.5 text-sm font-bold leading-relaxed" style={{ color: STEEL }}>
                  {t(`previews.gates.queue.${item.key}.sub`)}
                </p>
              </div>
              <span
                className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-[#17202a]"
                style={{ background: item.color }}
                aria-hidden
              />
            </div>
            <div className="mt-2.5 flex gap-2 text-sm font-bold">
              <span className="rounded-lg border-2 border-[#17202a] px-3 py-1 text-white" style={{ background: INK }}>
                {t("previews.gates.approve")}
              </span>
              <span className="rounded-lg border-2 border-[#17202a] bg-white px-3 py-1">{t("previews.gates.override")}</span>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(1.0, reduce)} className={`${HAND} mt-4 -rotate-1 text-base`} style={{ color: MOSS }}>
        {t("previews.gates.signed", { time: "14:02", name: "M. Horáková" })}
      </motion.p>
    </div>
  );
}
