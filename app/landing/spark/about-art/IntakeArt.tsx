"use client";

import { motion } from "framer-motion";
import { reveal } from "../motion-presets";
import { useStillMotion } from "../useStillMotion";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { CORAL, DISPLAY, LIMEWASH } from "../tokens";

/* 03 · Intake — five channels fly in and converge into one pipeline. */
const CHANNELS = ["apply", "email", "boards", "sourcing", "manual"] as const;

export default function IntakeArt({ color = CORAL }: { color?: string }) {
  const reduceMotion = useStillMotion();
  const t = useTranslations("aboutPage");
  return (
    <div className="mx-auto w-full max-w-lg text-center">
      <div className="flex flex-wrap justify-center gap-2">
        {CHANNELS.map((c, i) => (
          <motion.span
            key={c}
            {...reveal(
              "inView",
              reduceMotion,
              { opacity: 1, x: 0, rotate: i % 2 ? 1.5 : -1.5 },
              { delay: 0.1 + i * 0.09, type: "spring", bounce: 0.4 },
              { opacity: 0, x: i % 2 ? 60 : -60, rotate: i % 2 ? 10 : -10 }
            )}
            className="rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            {t(`art.intake.channels.${c}`)}
          </motion.span>
        ))}
      </div>
      <motion.div
        {...reveal(
          "inView",
          reduceMotion,
          { opacity: 1, scaleY: 1 },
          { delay: 0.6, duration: 0.3 },
          { opacity: 0, scaleY: 0 }
        )}
        className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full bg-[#17202a]"
        aria-hidden
      />
      <motion.div
        {...reveal(
          "inView",
          reduceMotion,
          { opacity: 1, scale: 1, y: 0 },
          { delay: 0.8, type: "spring", bounce: 0.5 },
          { opacity: 0, scale: 0.6, y: -8 }
        )}
        className="relative mx-auto inline-flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] px-6 py-4 shadow-[5px_5px_0_#17202a]"
        style={{ background: LIMEWASH }}
      >
        <Inbox className="h-6 w-6" aria-hidden />
        <span className={`${DISPLAY} text-lg font-bold`}>{t("art.intake.onePipeline")}</span>
        <motion.span
          {...reveal(
            "inView",
            reduceMotion,
            { opacity: 1, scale: 1, rotate: -6 },
            { delay: 1.05, type: "spring", bounce: 0.5 },
            { opacity: 0, scale: 2, rotate: 10 }
          )}
          className={`${DISPLAY} absolute -right-4 -top-4 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: color }}
        >
          47
        </motion.span>
      </motion.div>
    </div>
  );
}
