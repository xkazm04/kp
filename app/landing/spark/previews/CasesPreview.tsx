"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CORAL, HAND, MOSS, STEEL } from "../tokens";
import { ROW, StampChip, entrance, pop } from "./shared";
import { useStillMotion } from "../useStillMotion";

/*
 * 07 · Verified work-sample cases — the authorship receipt.
 *
 * Drawn honestly: the point is NOT "we detect AI", it is that the case ASSUMES
 * the code is AI-written and grades the judgment around it, using mechanical
 * checks with known ground truth. Keep that framing when translating —
 * `previews.cases.note` ("AI allowed — delegation isn't") is the thesis.
 */
const CHECKS = [
  { key: "flaw1", color: MOSS },
  { key: "flaw2", color: CORAL },
  { key: "distance", color: MOSS }
] as const;

export default function CasesPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-bold">{t("previews.cases.title")}</p>
        <StampChip background={MOSS}>{t("previews.cases.aiAllowed")}</StampChip>
      </div>
      <div className="mt-4 space-y-3">
        {CHECKS.map((c, i) => (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={entrance(reduce, { delay: 0.3 + i * 0.14, type: "spring", bounce: 0.4 })}
            className={`${ROW} flex items-center justify-between gap-3 p-3`}
          >
            <p className="text-[17px] font-semibold">{t(`previews.cases.checks.${c.key}.label`)}</p>
            <span className="whitespace-nowrap text-sm font-extrabold" style={{ color: c.color }}>
              {t(`previews.cases.checks.${c.key}.verdict`)}
            </span>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(0.75, reduce)} className={`${HAND} mt-4 text-base`} style={{ color: STEEL }}>
        {t("previews.cases.defend")}
      </motion.p>
    </div>
  );
}
