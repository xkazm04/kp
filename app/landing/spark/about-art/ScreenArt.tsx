"use client";

import { motion } from "framer-motion";
import { DRAW, reveal } from "../motion-presets";
import { useStillMotion } from "../useStillMotion";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { DISPLAY, MOSS } from "../tokens";

/* 04 · Screen — an evidence-backed fit dial that draws to 87 with factor chips. */
const FACTORS = ["skills", "seniority", "evidence"] as const;

export default function ScreenArt({ color = MOSS }: { color?: string }) {
  const reduceMotion = useStillMotion();
  const t = useTranslations("aboutPage");
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6">
      <div className="relative grid h-56 w-56 place-items-center">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="90" cy="90" r={R} fill="none" stroke="#e7dcc8" strokeWidth="16" />
          <motion.circle
            cx="90"
            cy="90"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={C}
            {...reveal(
              "inView",
              reduceMotion,
              { strokeDashoffset: C * (1 - 0.87) },
              { ...DRAW, duration: 1.1 },
              { strokeDashoffset: C }
            )}
          />
        </svg>
        <motion.div
          {...reveal(
            "inView",
            reduceMotion,
            { scale: 1, rotate: 0 },
            { type: "spring", bounce: 0.5, delay: 0.25 },
            { scale: 0, rotate: -12 }
          )}
          className={`${DISPLAY} absolute grid h-24 w-24 place-items-center rounded-full border-[3px] border-[#17202a] text-4xl font-extrabold text-white shadow-[4px_4px_0_#17202a]`}
          style={{ background: color }}
        >
          87
        </motion.div>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {FACTORS.map((f, i) => (
          <motion.span
            key={f}
            {...reveal(
              "inView",
              reduceMotion,
              { opacity: 1, y: 0 },
              { delay: 0.4 + i * 0.12, type: "spring", bounce: 0.4 },
              { opacity: 0, y: 10 }
            )}
            className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            <Check className="h-3.5 w-3.5" style={{ color }} aria-hidden />
            {t(`art.screen.factors.${f}`)}
          </motion.span>
        ))}
      </div>
    </div>
  );
}
