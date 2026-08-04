"use client";

import { Check, Mic } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CORAL, LIMEWASH, MOSS, STEEL } from "../tokens";
import { ConfirmBar, pop } from "./shared";

/*
 * 02 · Voice screening — it speaks Czech too.
 *
 * The two transcript lines stay **Czech in every locale**, on purpose. This
 * spotlight sits under the note "yes, it speaks Czech too" (`previews.voice.note`,
 * translated in all four locales), so the dialogue is the evidence for that
 * claim — translating it away would leave the claim unsupported. That is the
 * opposite of `landing.voice.transcript` on the page body, which shows *an*
 * interview and therefore follows the reader's language. Both are deliberate;
 * the message keys carry the same warning.
 */
export default function VoicePreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  const lines = [
    { who: "ai" as const, text: t("previews.voice.demoAi") },
    { who: "them" as const, text: t("previews.voice.demoThem") }
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.span
            {...pop(0.15)}
            className="grid h-10 w-10 place-items-center rounded-full border-[3px] border-[#17202a]"
            style={{ background: CORAL }}
          >
            <Mic className="h-4 w-4 text-white" aria-hidden />
          </motion.span>
          <div>
            <p className="text-[15px] font-bold">{t("previews.voice.screenTitle")}</p>
            <p className="text-sm font-bold" style={{ color: STEEL }}>
              {t("previews.voice.meta")}
            </p>
          </div>
        </div>
        <span className="flex h-6 items-end gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="voice-eq-bar w-1.5 rounded"
              style={{ height: "100%", background: MOSS, animationDelay: `${d}ms` }}
            />
          ))}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {lines.map((line, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, scale: 0.85, x: line.who === "ai" ? -24 : 24 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ delay: 0.35 + i * 0.3, type: "spring", bounce: 0.4 }}
            className={`max-w-[88%] rounded-2xl border-[3px] border-[#17202a] px-4 py-2.5 text-[15px] leading-snug ${
              line.who === "ai" ? "bg-white" : "ml-auto"
            }`}
            style={line.who === "ai" ? undefined : { background: LIMEWASH }}
          >
            {line.text}
          </motion.p>
        ))}
      </div>
      <ConfirmBar background={MOSS} icon={<Check className="h-4 w-4" aria-hidden />}>
        {t("previews.voice.scorecard")}
      </ConfirmBar>
    </div>
  );
}
