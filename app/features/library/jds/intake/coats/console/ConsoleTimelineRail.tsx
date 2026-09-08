"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { CONSOLE_SPRING, type ConsoleExchange } from "./consoleModel";

// THE TIMELINE RAIL — the conversation, once it is no longer the question.
//
// A chat log gives every turn the same weight, which is exactly wrong for a
// craft that is one question at a time: nineteen answered questions are HISTORY
// and the twentieth is the work. So history collapses to a column of ticks —
// one per exchange, numbered by the transcript index the brief's citations
// already use — and opening one is a deliberate act.
//
// Two pieces of shared layout run through here, and they are different objects:
//
//  · `console-tick-<index>` is the QUESTION ITSELF. While an exchange is the
//    current one its filled mark lives on the stage; the moment it is answered
//    the rail draws that same mark and framer morphs one into the other, so the
//    eye follows a single object from the stage down onto the rail instead of
//    watching one thing vanish and another appear. The rail therefore draws the
//    current exchange as an empty RING — the slot the mark will land in.
//  · `console-rail-cursor` is the READER's position: the pill behind whichever
//    tick is open, sliding between them. Same idiom as the segmented control.
//
// Under reduced motion both layoutIds are dropped rather than gated to zero
// duration: a shared-layout element with no animation still forces a layout
// read on every render, and the accommodation asks for the motion to stop, not
// to happen instantly.

export function ConsoleTimelineRail({
  exchanges,
  currentIndex,
  openIndex,
  onOpen,
}: {
  exchanges: readonly ConsoleExchange[];
  /** The exchange the stage is holding — its tick is the empty slot. */
  currentIndex: number | null;
  /** The exchange whose record is expanded, or null. */
  openIndex: number | null;
  onOpen: (index: number | null) => void;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const reduced = useReducedMotion();

  return (
    <nav
      aria-label={t("history")}
      className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-stone-200 pr-2"
    >
      {exchanges.map((ex) => {
        const isCurrent = ex.index === currentIndex;
        const isOpen = ex.index === openIndex;
        const label = t("turn", { turn: ex.index });
        return (
          <button
            key={ex.index}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={isOpen}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => onOpen(isOpen ? null : ex.index)}
            className={`focus-ring relative flex w-full shrink-0 flex-col items-center gap-1 rounded-md py-1.5 transition-colors ${
              isOpen ? "text-coral" : "text-stone-400 hover:text-steel"
            }`}
          >
            {isOpen ? (
              <motion.span
                layoutId={reduced ? undefined : "console-rail-cursor"}
                transition={CONSOLE_SPRING}
                className="absolute inset-0 rounded-md bg-coral/10 dark:rounded-lg"
                aria-hidden
              />
            ) : null}
            <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden>
              {isCurrent ? (
                // The slot. Empty on purpose — the filled mark is on the stage.
                <span className="h-2.5 w-2.5 rounded-full border border-coral" />
              ) : (
                <motion.span
                  layoutId={reduced ? undefined : `console-tick-${ex.index}`}
                  transition={CONSOLE_SPRING}
                  className={`rounded-full ${isOpen ? "h-2.5 w-2.5 bg-coral" : "h-1.5 w-1.5 bg-stone-400"}`}
                />
              )}
            </span>
            <span className="relative text-sm leading-none nums">{ex.index}</span>
          </button>
        );
      })}
    </nav>
  );
}
