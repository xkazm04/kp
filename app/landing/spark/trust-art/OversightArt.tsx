"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { AMBER, CORAL, HAND, INK, LIMEWASH, STEEL } from "../tokens";
import { useStillMotion } from "../useStillMotion";
import { ENTER, PILL } from "./shared";

/*
 * 02 · EU AI Act ready — the risk ladder, with hiring's rung called out.
 *
 * "Screening and ranking are treated as high-risk AI" is a sentence nobody
 * outside compliance can picture, so the panel draws the Act's own four-tier
 * ladder and drops a marker onto the rung hiring actually occupies. A reader
 * who has never opened the regulation leaves knowing two things: there is a
 * ladder, and we are on the second rung from the top — which is the honest
 * position and the one that obliges the three controls underneath.
 *
 * The tiers are the regulation's, not ours: unacceptable (banned outright),
 * high, limited, minimal. Widths widen downwards so the stack reads as a
 * pyramid — most AI is harmless, very little of it is this.
 */
const TIERS = [
  { key: "unacceptable", width: "56%", bg: INK, fg: "#fdf8ee" },
  { key: "high", width: "70%", bg: AMBER, fg: INK },
  { key: "limited", width: "85%", bg: LIMEWASH, fg: INK },
  { key: "minimal", width: "100%", bg: "#fff", fg: INK }
] as const;

// Three duties, three ticks. No per-duty glyph: a check plus an icon is two
// marks arguing the same thing, and the extra width pushed the row to wrap.
const CONTROLS = ["oversight", "reasoning", "record"] as const;

export default function OversightArt() {
  const t = useTranslations("landing");
  const rm = useStillMotion();

  return (
    <div className="w-full max-w-[520px]">
      <div className="space-y-2">
        {TIERS.map((tier, i) => {
          const ours = tier.key === "high";
          return (
            <div key={tier.key} className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <motion.div
                initial={rm ? false : { scaleX: 0, opacity: 0 }}
                whileInView={{ scaleX: 1, opacity: 1 }}
                viewport={ENTER}
                transition={{ delay: i * 0.1, type: "spring", bounce: 0.3 }}
                className="flex min-h-11 origin-left items-center rounded-xl border-[3px] border-[#17202a] px-3 py-1.5 shadow-[3px_3px_0_#17202a] sm:px-3.5"
                style={{ width: tier.width, background: tier.bg }}
              >
                <span className="text-[15px] font-extrabold leading-tight sm:text-sm" style={{ color: tier.fg }}>
                  {t(`trust.art.oversight.tiers.${tier.key}`)}
                </span>
              </motion.div>

              {/* The marker lands on the rung that applies to us, late enough
                  that the reader has seen the whole ladder first. */}
              {ours && (
                <motion.span
                  initial={rm ? false : { opacity: 0, x: 40, scale: 0.7, rotate: 8 }}
                  whileInView={{ opacity: 1, x: 0, scale: 1, rotate: -2 }}
                  viewport={ENTER}
                  transition={{ delay: 0.75, type: "spring", bounce: 0.5 }}
                  className="whitespace-nowrap rounded-full border-[3px] border-[#17202a] px-3 py-1 text-[13px] font-extrabold text-white shadow-[2px_2px_0_#17202a] sm:text-xs"
                  style={{ background: CORAL }}
                >
                  {t("trust.art.oversight.marker")}
                </motion.span>
              )}
            </div>
          );
        })}
      </div>

      <motion.p
        initial={rm ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={ENTER}
        transition={{ delay: 0.95 }}
        className={`${HAND} mt-3 text-sm`}
        style={{ color: STEEL }}
      >
        {t("trust.art.oversight.ladderNote")}
      </motion.p>

      {/* What sitting on that rung obliges. Three duties, checked off. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {CONTROLS.map((c, i) => (
          <motion.span
            key={c}
            initial={rm ? false : { opacity: 0, scale: 0.6, y: 12 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={ENTER}
            transition={{ delay: 1.1 + i * 0.13, type: "spring", bounce: 0.45 }}
            className={PILL}
          >
            <span
              className="grid h-4 w-4 place-items-center rounded-full"
              style={{ background: AMBER }}
              aria-hidden
            >
              <Check className="h-2.5 w-2.5" style={{ color: INK }} />
            </span>
            {t(`trust.art.oversight.controls.${c}`)}
          </motion.span>
        ))}
      </div>
    </div>
  );
}
