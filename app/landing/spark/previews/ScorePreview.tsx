"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AMBER, DISPLAY, LIMEWASH, MOSS, STEEL } from "../tokens";
import { PreviewNote, entrance, stamp } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 01 · Job-fit scoring — the dial, stamped. */
export default function ScorePreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  const R = 56;
  const C = 2 * Math.PI * R;
  // Scores are illustrative data, not copy — only the factor names translate.
  const factors = [
    { key: "skills", v: 92, color: MOSS },
    { key: "seniority", v: 84, color: MOSS },
    { key: "domain", v: 61, color: AMBER }
  ] as const;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 144 144" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="72" cy="72" r={R} fill="none" stroke={LIMEWASH} strokeWidth="14" />
          <motion.circle
            cx="72"
            cy="72"
            r={R}
            fill="none"
            stroke={MOSS}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - 0.87) }}
            transition={entrance(reduce, { duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.25 })}
          />
        </svg>
        <motion.div {...stamp(0.85, reduce)} className="absolute inset-0 grid place-items-center">
          <div
            className={`${DISPLAY} grid h-20 w-20 place-items-center rounded-full border-[3px] border-[#17202a] text-3xl font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
            style={{ background: MOSS }}
          >
            87
          </div>
        </motion.div>
      </div>
      <div className="w-full grow space-y-3.5">
        {factors.map((f, i) => (
          <div key={f.key}>
            <div className="flex justify-between text-sm font-bold" style={{ color: STEEL }}>
              <span>{t(`previews.score.factors.${f.key}`)}</span>
              <span className="nums">{f.v}</span>
            </div>
            <div className="mt-1 h-3 rounded-full border-2 border-[#17202a] bg-white">
              <motion.div
                className="h-full rounded-full"
                style={{ background: f.color }}
                initial={{ width: 0 }}
                animate={{ width: `${f.v}%` }}
                transition={entrance(reduce, { delay: 0.45 + i * 0.16, type: "spring", bounce: 0.25 })}
              />
            </div>
          </div>
        ))}
        <PreviewNote delay={1.1} color={MOSS}>
          {t("previews.score.verdict")}
        </PreviewNote>
      </div>
    </div>
  );
}
