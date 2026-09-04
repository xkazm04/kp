"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, HAND, MOSS, STEEL } from "../tokens";
import { ROW, pop } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 08 · Talent rediscovery — the pool you already paid for. */
// Match scores are data; the colour follows the score rather than sniffing the
// rendered string for "91" the way this used to.
const HITS = [
  { key: "marek", name: "Marek D.", score: 91, color: MOSS },
  { key: "lucie", name: "Lucie H.", score: 84, color: AMBER }
] as const;

export default function RediscoverPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  return (
    <div>
      <p className="text-[17px] font-bold">{t("previews.rediscover.title", { n: HITS.length })}</p>
      <div className="mt-4 space-y-3">
        {HITS.map((h, i) => (
          <motion.div key={h.key} {...pop(0.3 + i * 0.16, reduce)} className={`${ROW} p-3.5`}>
            <p className="text-[17px] font-bold">{h.name}</p>
            <p className="text-sm font-semibold" style={{ color: h.color }}>
              {t(`previews.rediscover.hits.${h.key}`, { score: h.score })}
            </p>
          </motion.div>
        ))}
      </div>
      <motion.p {...pop(0.7, reduce)} className={`${HAND} mt-4 text-base`} style={{ color: STEEL }}>
        {t("previews.rediscover.noSpend")}
      </motion.p>
    </div>
  );
}
