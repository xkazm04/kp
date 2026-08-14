"use client";

// Analytics → Performance: "how is hiring actually going".
//
// PROTOTYPE SCAFFOLD (throwaway). The section hosts a variant switcher so three
// directional designs can be A/B'd live against the baseline. `baseline` is the
// default, so nothing changes on load. When a direction wins, the switcher and
// the losing files are deleted and the winner is rendered directly.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { PerformanceBaseline } from "./PerformanceBaseline";
import { PerformanceFlightDeck } from "./PerformanceFlightDeck";
import { PerformanceBriefing } from "./PerformanceBriefing";
import { PerformanceScoreboard } from "./PerformanceScoreboard";
import type { PerformanceProps } from "./performanceTypes";

const VARIANTS = [
  { id: "baseline", label: "Baseline", hint: "today's layout, regrouped" },
  { id: "deck", label: "Flight deck", hint: "cockpit — vitals rail, one screen" },
  { id: "briefing", label: "Briefing", hint: "editorial — claims, then proof" },
  { id: "scoreboard", label: "Scoreboard", hint: "league table — roles ranked" },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

export function PerformanceSection(props: PerformanceProps) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const reduced = useReducedMotion();
  return (
    <div className="space-y-5">
      {/* Prototype-only chrome: plain English, deliberately un-designed so it
          never gets mistaken for part of a variant. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 p-2">
        {/* eslint-disable-next-line i18next/no-literal-string -- throwaway prototype
            scaffold: this strip and its labels are deleted when a variant wins, so
            translating them into four locales would be work with a known expiry. */}
        <span className="px-1 text-meta uppercase text-steel">Prototype</span>
        {VARIANTS.map((v) => {
          const active = variant === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={active}
              title={v.hint}
              className={`focus-ring relative rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                active ? "text-white" : "text-steel hover:bg-stone-100 hover:text-ink"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId="perf-variant-pill"
                  className="absolute inset-0 z-0 rounded-md bg-ink"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10">{v.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={variant}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
        >
          {variant === "baseline" ? <PerformanceBaseline {...props} /> : null}
          {variant === "deck" ? <PerformanceFlightDeck {...props} /> : null}
          {variant === "briefing" ? <PerformanceBriefing {...props} /> : null}
          {variant === "scoreboard" ? <PerformanceScoreboard {...props} /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
