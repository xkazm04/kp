"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { DISPLAY, STICKER } from "../tokens";

/* "How it works" — three steps. Target of the #how rail entry. */
const STEPS = [
  { key: "drop", color: "#d65a4a" },
  { key: "talk", color: "#caa54c" },
  { key: "call", color: "#526b4f" }
] as const;

export default function Steps() {
  const t = useTranslations("landing");
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-6 py-24">
      <motion.h2
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
      >
        {t.rich("steps.heading", {
          br: () => <br />,
          emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
        })}
      </motion.h2>

      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <motion.article
            key={step.key}
            initial={{ opacity: 0, y: 32, rotate: 0 }}
            whileInView={{ opacity: 1, y: 0, rotate: i === 1 ? 1 : -1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.12, type: "spring", bounce: 0.35 }}
            whileHover={{ rotate: 0, scale: 1.02 }}
            className={`${STICKER} p-7`}
          >
            <span
              className={`${DISPLAY} grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#17202a] text-xl font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
              style={{ background: step.color }}
            >
              {i + 1}
            </span>
            <h3 className={`${DISPLAY} mt-5 text-2xl font-bold`}>{t(`steps.${step.key}.title`)}</h3>
            <p className="mt-3 leading-relaxed text-[#42606f]">{t(`steps.${step.key}.body`)}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
