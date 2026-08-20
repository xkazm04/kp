"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check, Mic } from "lucide-react";
import { ENTER } from "./shared";

/* 05 · Interview — a voice screen card: live equalizer + transcript bubbles. */
export default function InterviewArt({ color = "#d65a4a" }: { color?: string }) {
  const t = useTranslations("aboutPage");
  const bubbles = [
    { ai: true, text: t("art.interview.askAi") },
    { ai: false, text: t("art.interview.replyThem") }
  ];
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border-[3px] border-[#17202a] bg-white p-5 shadow-[6px_6px_0_#17202a]">
      <div className="flex items-center gap-3 border-b-[3px] border-dashed border-[#dce7d0] pb-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#17202a]"
          style={{ background: color }}
        >
          <Mic className="h-4 w-4 text-white" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold">{t("art.interview.screenTitle")}</p>
          <p className="text-xs font-bold text-[#42606f]">{t("art.interview.meta")}</p>
        </div>
        {/* The same equalizer the landing's VoicePreview draws, and via the same
            shared `.voice-eq-bar` keyframe — which app/globals.css switches off
            under prefers-reduced-motion. A framer `repeat: Infinity` is not
            gated by anything (no MotionConfig here), so this loop is the one
            animation on the page that would never stop for a visitor who asked
            it to. Staggered delays inline, one per bar. */}
        <div className="flex h-6 items-end gap-1" aria-hidden>
          {[0, 120, 240, 360].map((delay) => (
            <span
              key={delay}
              className="voice-eq-bar w-1.5 rounded"
              style={{ height: "100%", background: color, animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        {bubbles.map((b, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, x: b.ai ? -18 : 18, scale: 0.9 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={ENTER}
            transition={{ delay: 0.25 + i * 0.3, type: "spring", bounce: 0.35 }}
            className={`max-w-[85%] rounded-2xl border-[3px] border-[#17202a] px-3.5 py-2 text-sm leading-snug ${
              b.ai ? "bg-[#fdf8ee]" : "ml-auto"
            }`}
            style={b.ai ? undefined : { background: "#dce7d0" }}
          >
            {b.text}
          </motion.p>
        ))}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={ENTER}
          transition={{ delay: 1, type: "spring", bounce: 0.4 }}
          className="mt-1 flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-3.5 py-2 text-sm font-bold text-white shadow-[3px_3px_0_#17202a]"
          style={{ background: "#526b4f" }}
        >
          <Check className="h-4 w-4" aria-hidden />
          {t("art.interview.scorecard")}
        </motion.div>
      </div>
    </div>
  );
}
