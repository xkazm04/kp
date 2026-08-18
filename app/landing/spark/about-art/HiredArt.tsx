"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { DISPLAY, HAND } from "../tokens";
import { ENTER } from "./shared";

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
  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="relative grid h-36 place-items-center">
        {CONFETTI.map((d, i) => (
          <motion.span
            key={i}
            aria-hidden
            initial={{ opacity: 0, scale: 0 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={ENTER}
            transition={{ delay: 0.4 + i * 0.1, type: "spring", bounce: 0.6 }}
            className="absolute h-3 w-3 rounded-full border-2 border-[#17202a]"
            style={{ background: d.c, left: d.left, top: d.top }}
          />
        ))}
        <motion.div
          initial={{ scale: 2.2, opacity: 0, rotate: 12 }}
          whileInView={{ scale: 1, opacity: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} grid h-28 w-28 place-items-center rounded-full border-[4px] border-[#17202a] text-2xl font-extrabold uppercase text-white shadow-[5px_5px_0_#17202a]`}
          style={{ background: color }}
        >
          {t("art.hired.seal")}
        </motion.div>
      </div>
      <div className="mt-5 space-y-2 rounded-2xl border-[3px] border-[#17202a] bg-white p-4 shadow-[5px_5px_0_#17202a]">
        <p className={`${HAND} text-sm text-[#526b4f]`}>{t("art.hired.handoff")}</p>
        {TASKS.map((task, i) => (
          <motion.div
            key={task}
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={ENTER}
            transition={{ delay: 0.3 + i * 0.18, type: "spring", bounce: 0.4 }}
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
