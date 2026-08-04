"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Mic, Stamp } from "lucide-react";
import { DISPLAY, STICKER } from "../tokens";

/*
 * Voice teaser — the pitch plus a mock transcript card. Target of the #voice
 * rail entry and the hero's third CTA.
 *
 * Unlike the voice *spotlight* (previews/VoicePreview.tsx, deliberately Czech),
 * this transcript follows the reader's language: it shows *an* interview, not
 * specifically a Czech one.
 */
// Who speaks each transcript line; the words come from landing.voice.transcript.
const TRANSCRIPT_WHO = ["ai", "them", "ai"] as const;

export default function VoiceTeaser() {
  const t = useTranslations("landing");
  const bullets = t.raw("voice.bullets") as string[];
  const transcript = t.raw("voice.transcript") as string[];
  return (
    <section id="voice" className="mx-auto w-full max-w-6xl px-6 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className={`${DISPLAY} text-4xl font-extrabold sm:text-5xl`}
          >
            {t.rich("voice.heading", {
              br: () => <br />,
              emph: (chunks) => <span className="text-[#d65a4a]">{chunks}</span>
            })}
          </motion.h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#42606f]">{t("voice.body")}</p>
          <ul className="mt-6 space-y-3 text-base font-bold">
            {bullets.map((li) => (
              <li key={li} className="flex items-center gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-full border-[3px] border-[#17202a] bg-[#caa54c] shadow-[2px_2px_0_#17202a]">
                  <Stamp className="h-3.5 w-3.5" aria-hidden />
                </span>
                {li}
              </li>
            ))}
          </ul>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32, rotate: 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ type: "spring", bounce: 0.3 }}
          className={`${STICKER} p-6`}
        >
          <div className="flex items-center justify-between border-b-[3px] border-dashed border-[#dce7d0] pb-4">
            <div className="flex items-center gap-3">
              <span className="relative grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#17202a] bg-[#d65a4a]">
                <Mic className="h-4 w-4 text-white" aria-hidden />
              </span>
              <div>
                <p className="text-[15px] font-bold">{t("voice.cardTitle")}</p>
                <p className="text-sm text-[#42606f]">{t("voice.cardMeta")}</p>
              </div>
            </div>
            <span className="flex h-6 items-end gap-1" aria-hidden>
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="voice-eq-bar w-1.5 rounded bg-[#526b4f]"
                  style={{ height: "100%", animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {transcript.map((text, i) => {
              const who = TRANSCRIPT_WHO[i];
              return (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, x: who === "ai" ? -16 : 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.25 }}
                  className={`max-w-[85%] rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] leading-snug ${
                    who === "ai" ? "bg-[#fdf8ee]" : "ml-auto bg-[#dce7d0]"
                  }`}
                >
                  {text}
                </motion.p>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
