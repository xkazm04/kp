"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { PANEL } from "@/app/_components/ui/recipes";

const MODES = [
  { id: "new", labelKey: "modeNew" },
  { id: "history", labelKey: "modeHistory" },
] as const;

// Tier 3 (docs/design/loading-choreography.md): only one of these two panes is on
// screen at a time (the segmented switch above), so each gets its own chunk —
// entering on "new" must not pull History's fetch/table code into the entry
// bundle, and vice versa. The loading gap is a quiet reserved-height box, never
// a skeleton; it is normally invisible since the sibling chunk is already
// warm by the time anyone switches.
const AnalyzeTab = dynamic(() => import("./AnalyzeTab").then((m) => ({ default: m.AnalyzeTab })), {
  loading: () => <div className="reveal-quiet min-h-[24rem]" aria-hidden />,
});
const HistoryTab = dynamic(
  () => import("@/app/features/tools/analyze/history/HistoryTab").then((m) => ({ default: m.HistoryTab })),
  { loading: () => <div className="reveal-quiet min-h-[24rem]" aria-hidden /> }
);

// Consolidates the v1 deep-analysis tool and its saved-runs list into one
// surface with a segmented switch, so they occupy a single sidebar slot.
//
// The active state rides on a shared-layout `bg-ink` pill (layoutId="analyze-seg")
// that slides between labels instead of hard-flipping, and the panel below
// crossfades with a small slide as it swaps — establishing the segmented-control
// motion standard reused by the app's other toggles. Both effects snap to their
// end state under the OS "reduce motion" preference.
export function AnalyzeWorkspace({ initialMode = "new" }: { initialMode?: "new" | "history" }) {
  const t = useTranslations("analyze");
  const [mode, setMode] = useState<"new" | "history">(initialMode);
  const reduced = useReducedMotion();
  return (
    <div className="space-y-4">
      <div className={`${PANEL} inline-flex p-1`}>
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={active}
              className={`focus-ring relative h-9 rounded-md px-4 text-base font-semibold transition-colors ${
                active ? "text-white" : "text-steel hover:bg-paper hover:text-ink"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId="analyze-seg"
                  className="absolute inset-0 z-0 rounded-md bg-ink"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10">{t(m.labelKey)}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
        >
          {mode === "new" ? <AnalyzeTab /> : <HistoryTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
