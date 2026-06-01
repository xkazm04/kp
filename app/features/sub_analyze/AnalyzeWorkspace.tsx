"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AnalyzeTab } from "./AnalyzeTab";
import { HistoryTab } from "@/app/features/sub_history/HistoryTab";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

const MODES = [
  { id: "new", label: "New analysis" },
  { id: "history", label: "History" },
] as const;

// Consolidates the v1 deep-analysis tool and its saved-runs list into one
// surface with a segmented switch, so they occupy a single sidebar slot.
//
// The active state rides on a shared-layout `bg-ink` pill (layoutId="analyze-seg")
// that slides between labels instead of hard-flipping, and the panel below
// crossfades with a small slide as it swaps — establishing the segmented-control
// motion standard reused by the app's other toggles. Both effects snap to their
// end state under the OS "reduce motion" preference.
export function AnalyzeWorkspace({ initialMode = "new" }: { initialMode?: "new" | "history" }) {
  const [mode, setMode] = useState<"new" | "history">(initialMode);
  const reduced = useReducedMotion();
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-panel">
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
              <span className="relative z-10">{m.label}</span>
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
