"use client";

import { motion } from "framer-motion";
import { DRAW, reveal } from "../motion-presets";
import { useStillMotion } from "../useStillMotion";
import { useTranslations } from "next-intl";
import { DISPLAY, HAND, STEEL } from "../tokens";

/* 01 · Design — a JD assembling itself: title, must-have chips, salary band. */
// Technology names are DNT: a Czech reader looks for "Java", not a translation.
const SKILL_CHIPS = ["Java", "Spring", "SQL", "REST"];

export default function DesignArt({ color = STEEL }: { color?: string }) {
  const reduceMotion = useStillMotion();
  const t = useTranslations("aboutPage");
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center gap-3">
        <span
          className={`${DISPLAY} grid h-10 w-10 place-items-center rounded-xl border-[3px] border-[#17202a] text-sm font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: color }}
        >
          {t("art.design.badge")}
        </span>
        <div>
          <p className="text-sm font-bold">{t("art.design.roleTitle")}</p>
          <p className="text-xs font-bold text-[#42606f]">{t("art.design.employer")}</p>
        </div>
      </div>
      <p className={`${HAND} mt-4 text-sm text-[#526b4f]`}>{t("art.design.mustHaves")}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {SKILL_CHIPS.map((c, i) => (
          <motion.span
            key={c}
            {...reveal(
              "inView",
              reduceMotion,
              { opacity: 1, scale: 1, rotate: 0 },
              { delay: 0.15 + i * 0.1, type: "spring", bounce: 0.5 },
              { opacity: 0, scale: 0.6, rotate: -8 }
            )}
            className="rounded-full border-[3px] border-[#17202a] bg-[#fdf8ee] px-3 py-1 text-sm font-bold shadow-[2px_2px_0_#17202a]"
          >
            {c}
          </motion.span>
        ))}
      </div>
      <p className={`${HAND} mt-4 text-sm text-[#526b4f]`}>{t("art.design.salaryBand")}</p>
      <div className="mt-1 h-4 w-full overflow-hidden rounded-full border-[3px] border-[#17202a] bg-[#dce7d0]">
        <motion.div
          {...reveal(
            "inView",
            reduceMotion,
            { width: "72%" },
            { ...DRAW, delay: 0.4 },
            { width: 0 }
          )}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <p className="mt-1 text-sm font-bold text-[#42606f]">{t("art.design.bandValue")}</p>
    </div>
  );
}
