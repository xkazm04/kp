"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Eye, FileSearch, Gauge, ShieldCheck } from "lucide-react";
import { DISPLAY, STICKER } from "../tokens";

/*
 * Responsible-AI pillars (UAT B2): the public compliance story a regulated
 * buyer needs before they'll pilot. Target of the #trust rail entry.
 */
const COMPLIANCE = [
  { key: "human", icon: ShieldCheck, color: "#526b4f" },
  { key: "oversight", icon: Eye, color: "#42606f" },
  { key: "gdpr", icon: FileSearch, color: "#d65a4a" },
  { key: "audit", icon: Gauge, color: "#caa54c" }
] as const;

export default function TrustPillars() {
  const t = useTranslations("landing");
  return (
    <section id="trust" className="border-y-[3px] border-[#17202a] bg-[#fdf8ee] py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
        >
          {t.rich("trust.heading", {
            br: () => <br />,
            emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
          })}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-[#42606f]"
        >
          {t("trust.subtitle")}
        </motion.p>
        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {COMPLIANCE.map((pillar, i) => (
            <motion.article
              key={pillar.key}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0, rotate: i % 2 === 0 ? -1 : 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1, type: "spring", bounce: 0.35 }}
              whileHover={{ rotate: 0, scale: 1.02 }}
              className={`${STICKER} p-7`}
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#17202a] text-white shadow-[3px_3px_0_#17202a]"
                style={{ background: pillar.color }}
              >
                <pillar.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className={`${DISPLAY} mt-5 text-xl font-bold`}>{t(`trust.${pillar.key}.title`)}</h3>
              <p className="mt-3 leading-relaxed text-[#42606f]">{t(`trust.${pillar.key}.body`)}</p>
            </motion.article>
          ))}
        </div>
        <p className="mt-8 text-sm italic text-[#42606f]">{t("trust.footnote")}</p>
      </div>
    </section>
  );
}
