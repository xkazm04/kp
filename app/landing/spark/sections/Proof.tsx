"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { FlaskConical, Mic, Stamp } from "lucide-react";
import { DISPLAY, HAND, STICKER } from "../tokens";

/*
 * The wedge band — the landing's headline claim, expanded right under the
 * hero: "did the candidate write it, or the model?" is the defining hiring
 * question of 2026, and this band shows the three mechanisms that answer it
 * (verified work samples, an interview about the candidate's own decisions,
 * sealed auditable verdicts). The positioning call comes from
 * docs/product/competitor-talentpilot.md §4: anti-AI-delegation is a whole
 * module here and one unspecified bullet for the competitor, so it leads the
 * page instead of hiding as card three of nine. The FeatureGrid keeps its
 * `cases` card; this band is the story, the grid is the inventory.
 *
 * Dark steel band so the proof block reads as its own register between the
 * cream hero and the cream steps — same sticker vocabulary, inverted ground.
 */
const CARDS = [
  { key: "samples", icon: FlaskConical, color: "#d65a4a" },
  { key: "defend", icon: Mic, color: "#caa54c" },
  { key: "sealed", icon: Stamp, color: "#526b4f" }
] as const;

export default function Proof() {
  const t = useTranslations("landing");
  return (
    <section id="proof" className="border-b-[3px] border-[#17202a] bg-[#42606f] py-24">
      <div className="mx-auto w-full max-w-7xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className={`${DISPLAY} text-4xl font-extrabold text-[#fdf8ee] sm:text-5xl`}
        >
          {t.rich("proof.heading", {
            br: () => <br />,
            emph: (chunks) => <span className="text-[#caa54c]">{chunks}</span>
          })}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-[#dce7d0]"
        >
          {t("proof.subtitle")}
        </motion.p>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <motion.article
              key={card.key}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0, rotate: i % 2 === 0 ? -1 : 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1, type: "spring", bounce: 0.35 }}
              whileHover={{ rotate: 0, scale: 1.02 }}
              className={`${STICKER} p-7`}
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-[#17202a] text-white shadow-[3px_3px_0_#17202a]"
                style={{ background: card.color }}
              >
                <card.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className={`${DISPLAY} mt-5 text-xl font-bold`}>{t(`proof.cards.${card.key}.title`)}</h3>
              <p className="mt-3 leading-relaxed text-[#42606f]">{t(`proof.cards.${card.key}.body`)}</p>
            </motion.article>
          ))}
        </div>
        <p className={`${HAND} mt-8 -rotate-1 text-lg text-[#dce7d0]`}>{t("proof.footline")}</p>
      </div>
    </section>
  );
}
