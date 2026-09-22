"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { DISPLAY, HAND } from "../tokens";
import { ENTER } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 07 · Hired — a stamped seal + confetti, with the hire's close-out checking off. */
const CONFETTI = [
  { c: "#caa54c", left: "-8%", top: "8%" },
  { c: "#d65a4a", left: "104%", top: "0%" },
  { c: "#42606f", left: "100%", top: "78%" },
  { c: "#caa54c", left: "-6%", top: "82%" }
];
const TASKS = ["record", "ats", "role"] as const;

export default function HiredArt({ color = "#526b4f" }: { color?: string }) {
  const t = useTranslations("aboutPage");
  const reduceMotion = useStillMotion();
  const [stampReplay, setStampReplay] = useState(0);
  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="relative grid h-36 place-items-center">
        {CONFETTI.map((d, i) => (
          <motion.span
            key={i}
            aria-hidden
            initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
            whileInView={{ opacity: 1, scale: 1 }}
            animate={reduceMotion ? { opacity: 1, scale: 1 } : undefined}
            viewport={ENTER}
            transition={reduceMotion ? { duration: 0 } : { delay: 0.4 + i * 0.1, type: "spring", bounce: 0.6 }}
            className="absolute h-3 w-3 rounded-full border-2 border-[#17202a]"
            style={{ background: d.c, left: d.left, top: d.top }}
          />
        ))}
        <motion.div
          key={stampReplay}
          initial={reduceMotion ? { scale: 1, opacity: 1, rotate: -6 } : { scale: 2.2, opacity: 0, rotate: 12 }}
          whileInView={{ scale: 1, opacity: 1, rotate: -6 }}
          animate={reduceMotion ? { scale: 1, opacity: 1, rotate: -6 } : undefined}
          viewport={ENTER}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} grid h-28 w-28 place-items-center rounded-full border-[4px] border-[#17202a] text-2xl font-extrabold uppercase text-white shadow-[5px_5px_0_#17202a]`}
          style={{ background: color }}
        >
          {t("art.hired.seal")}
        </motion.div>
      </div>
      <div className="mt-2 flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => setStampReplay((n) => n + 1)}
          className="rounded-lg border-[3px] border-[#17202a] bg-white px-3 py-1 text-sm font-bold shadow-[3px_3px_0_#17202a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17202a]"
        >
          {t("art.hired.replaySeal")}
        </button>
        <p aria-live="polite" className="min-h-5 text-xs font-bold text-[#526b4f]">
          {stampReplay > 0 ? <span key={stampReplay}>{t("art.hired.replayed")}</span> : null}
        </p>
      </div>
      <div className="mt-5 space-y-2 rounded-2xl border-[3px] border-[#17202a] bg-white p-4 shadow-[5px_5px_0_#17202a]">
        <p className={`${HAND} text-sm text-[#526b4f]`}>{t("art.hired.handoff")}</p>
        {TASKS.map((task, i) => (
          <motion.div
            key={task}
            initial={reduceMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            animate={reduceMotion ? { opacity: 1, x: 0 } : undefined}
            viewport={ENTER}
            transition={reduceMotion ? { duration: 0 } : { delay: 0.3 + i * 0.18, type: "spring", bounce: 0.4 }}
            className="flex items-center gap-2 text-sm font-bold"
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
              style={{ background: color }}
              aria-hidden
            >
              <Check className="h-3 w-3 text-white" />
            </span>
            {t(`art.hired.tasks.${task}`)}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
