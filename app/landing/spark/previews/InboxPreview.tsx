"use client";

import { Inbox, Mail, MousePointerClick, Newspaper, PenLine, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CORAL, DISPLAY, LIMEWASH, STEEL } from "../tokens";
import { PreviewNote, Stem, entrance, stamp } from "./shared";
import { useStillMotion } from "../useStillMotion";

/* 04 · One inbox, five doors — channels fly home. */
const CHANNELS = [
  { key: "apply", icon: MousePointerClick },
  { key: "email", icon: Mail },
  { key: "boards", icon: Newspaper },
  { key: "sourcing", icon: Search },
  { key: "manual", icon: PenLine }
] as const;

export default function InboxPreview() {
  // next-intl's typed catalog only exposes TOP-LEVEL namespaces, so scope to
  // `landing` and reach this preview's keys by path.
  const t = useTranslations("landing");
  // Reduced motion: the transition, never the markup — see ./shared.tsx.
  const reduce = useStillMotion();
  return (
    <div className="text-center">
      <div className="flex flex-wrap justify-center gap-2.5">
        {CHANNELS.map((c, i) => (
          <motion.span
            key={c.key}
            initial={{ opacity: 0, x: i % 2 === 0 ? -70 : 70, rotate: i % 2 === 0 ? -10 : 10 }}
            animate={{ opacity: 1, x: 0, rotate: i % 2 === 0 ? -1.5 : 1.5 }}
            transition={entrance(reduce, { delay: 0.15 + i * 0.1, type: "spring", bounce: 0.4 })}
            className="inline-flex items-center gap-1.5 rounded-full border-[3px] border-[#17202a] bg-white px-3.5 py-1.5 text-sm font-bold shadow-[3px_3px_0_#17202a]"
          >
            <c.icon className="h-3.5 w-3.5" style={{ color: CORAL }} aria-hidden />
            {t(`previews.inbox.channels.${c.key}`)}
          </motion.span>
        ))}
      </div>
      <Stem />
      <motion.div
        initial={{ opacity: 0, scale: 0.6, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={entrance(reduce, { delay: 0.95, type: "spring", bounce: 0.5 })}
        className="relative mx-auto inline-flex items-center gap-3 rounded-2xl border-[3px] border-[#17202a] px-6 py-4 shadow-[5px_5px_0_#17202a]"
        style={{ background: LIMEWASH }}
      >
        <Inbox className="h-6 w-6" aria-hidden />
        <span className={`${DISPLAY} text-lg font-bold`}>{t("previews.inbox.onePipeline")}</span>
        <motion.span
          {...stamp(1.35, reduce)}
          className={`${DISPLAY} absolute -right-4 -top-4 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#17202a] text-base font-extrabold text-white shadow-[3px_3px_0_#17202a]`}
          style={{ background: CORAL }}
        >
          47
        </motion.span>
      </motion.div>
      <PreviewNote delay={1.5} color={STEEL}>
        {t("previews.inbox.sameStartingLine")}
      </PreviewNote>
    </div>
  );
}
