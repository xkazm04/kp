"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { DISPLAY } from "../tokens";

/* The scrolling claim band between the hero and the three steps. */
export default function Marquee() {
  const t = useTranslations("landing");
  const reduceMotion = useReducedMotion();
  // Arrays come back raw from the catalog (next-intl returns them verbatim).
  const items = t.raw("marquee") as string[];
  return (
    <div className="overflow-hidden border-y-[3px] border-[#17202a] bg-[#d65a4a] py-3">
      <motion.div
        className="flex w-max items-center gap-10 whitespace-nowrap pr-10"
        animate={reduceMotion ? undefined : { x: ["0%", "-50%"] }}
        transition={{ duration: 26, ease: "linear", repeat: Infinity }}
      >
        {/* Doubled so the -50% loop is seamless. */}
        {[...items, ...items].map((item, i) => (
          <span key={i} className={`${DISPLAY} flex items-center gap-10 text-lg font-bold text-[#fdf8ee]`}>
            {item}
            <Sparkles aria-hidden className="h-4 w-4 text-[#caa54c]" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}
