"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { DISPLAY } from "../tokens";
import { ENTER } from "./shared";

/* 03 · Intake — five channels fly in and converge into one pipeline. */
const CHANNELS = ["apply", "email", "boards", "sourcing", "manual"] as const;

export default function IntakeArt({ color = "#d65a4a" }: { color?: string }) {
  const t = useTranslations("aboutPage");
  return (
    <div className="mx-auto w-full max-w-md text-center">
      <div className="flex flex-wrap justify-center gap-2">
        {CHANNELS.map((c, i) => (
          <motion.span
            key={c}
            initial={{ opacity: 0, x: i % 2 ? 60 : -60, rotate: i % 2 ? 10 : -10 }}
            whileInView={{ opacity: 1, x: 0, rotate: i % 2 ? 1.5 : -1.5 }}
            viewport={ENTER}
            transition={{ delay: 0.1 + i * 0.09, type: "spring", bounce: 0.4 }}
            className="rounded-full border-[3px] border-[#17202a] bg-white px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            {t(`art.intake.channels.${c}`)}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={ENTER}
        transition={{ delay: 0.6, duration: 0.3 }}
        className="mx-auto mt-3 h-7 w-1.5 origin-top rounded-full bg-[#17202a]"
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: -8 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={ENTER}
        transition={{ delay: 0.8, type: "spring", bounce: 0.5 }}
        className="relative mx-auto inline-flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] px-6 py-4 shadow-[5px_5px_0_#17202a]"
        style={{ background: "#dce7d0" }}
      >
        <Inbox className="h-6 w-6" aria-hidden />
        <span className={`${DISPLAY} text-lg font-bold`}>{t("art.intake.onePipeline")}</span>
        <motion.span
          initial={{ opacity: 0, scale: 2, rotate: 10 }}
          whileInView={{ opacity: 1, scale: 1, rotate: -6 }}
          viewport={ENTER}
          transition={{ delay: 1.05, type: "spring", bounce: 0.5 }}
          className={`${DISPLAY} absolute -right-4 -top-4 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: color }}
        >
          47
        </motion.span>
      </motion.div>
    </div>
  );
}
