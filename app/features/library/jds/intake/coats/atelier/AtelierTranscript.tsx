"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { compactedTurnCount } from "@/app/_lib/intake-transcript";
import { JdsIntakeChoiceCards } from "../../JdsIntakeChoiceCards";
import type { IntakeTurn } from "../../jdsIntakeLogic";
import { ATELIER_SPRING, ATELIER_EASE } from "./atelierPlane";

// ATELIER — the conversation as TURN BLOCKS on the plane.
//
// This is the single biggest change the coat makes, because the bubble is what
// made a working document read as a chat toy: two rounded lozenges alternating
// left and right, each one a little box inside the leaf that was already a box.
// A block keeps every fact the bubble carried and spends no geometry on it —
// a 2px rule in the gutter says WHO (coral = the agent, steel = the requestor,
// stone = the seam the system reports), a tiny uppercase mark repeats it in
// words for anyone the colour does not reach, and the sentence gets the full
// measure and a reading leading instead of 85% of the column and a lozenge.
//
// THINKING MORPHS INTO THE ANSWER. The waiting mark and the turn that replaces
// it share a `layoutId` — `atelier-turn-<index>`, the index the reply will
// occupy — so the coral rule GROWS from the waiting mark into the arrived turn
// instead of one element unmounting and an unrelated one appearing. The id
// advances with the transcript, so no two elements ever hold it at once.
//
// AUTOSCROLL DOES NOT YANK. The list follows the newest turn only while the
// reader is already at the foot of it; scroll up to re-read an earlier answer
// and a landing reply leaves the viewport where you put it.

const GUTTER: Record<string, string> = {
  interviewer: "bg-coral",
  candidate: "bg-steel",
  system: "bg-stone-300",
};

const ROLE_KEY: Record<string, "agent" | "requestor" | "system"> = {
  interviewer: "agent",
  candidate: "requestor",
  system: "system",
};

/** Within this many pixels of the foot counts as "reading the newest turn". */
const FOLLOW_SLACK_PX = 96;

export function AtelierTranscript({
  transcript,
  sending,
  closed,
  onSend,
  onDeclineChoices,
  highlightTurn,
  onHighlightDone,
  statusNote,
}: {
  transcript: IntakeTurn[];
  sending: boolean;
  closed: boolean;
  onSend: (message: string) => void | Promise<boolean>;
  /** "None of these" — the composer takes the turn back. */
  onDeclineChoices?: () => void;
  highlightTurn?: number | null;
  onHighlightDone?: () => void;
  statusNote?: string | null;
}) {
  const t = useTranslations("library.tab.intake");
  const reduced = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef(new Map<number, HTMLDivElement>());
  const flash = useFlash(highlightTurn, onHighlightDone);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atFoot = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
    if (atFoot) el.scrollTo({ top: el.scrollHeight });
  }, [transcript.length, sending]);

  useEffect(() => {
    if (flash == null) return;
    turnRefs.current.get(flash)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [flash]);

  const lastIndex = transcript.length - 1;
  // The slot the reply will land in — shared by the waiting mark and, once it
  // lands, by the turn itself.
  const pendingId = `atelier-turn-${transcript.length}`;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1"
      aria-live="polite"
      aria-label={t("composer.transcriptLabel")}
    >
      {transcript.map((turn, index) => {
        const compacted = compactedTurnCount(turn);
        const role = ROLE_KEY[turn.role] ?? "system";
        const choices = turn.choices;
        const morph = index === lastIndex && turn.role === "interviewer";
        return (
          <motion.div
            key={index}
            ref={(el) => {
              if (el) turnRefs.current.set(index, el);
              else turnRefs.current.delete(index);
            }}
            initial={{ opacity: reduced ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: ATELIER_EASE }}
            className="relative pl-4"
          >
            <motion.span
              layoutId={morph ? `atelier-turn-${index}` : undefined}
              transition={reduced ? { duration: 0 } : ATELIER_SPRING}
              className={`absolute inset-y-0 left-0 w-0.5 rounded-full ${flash === index ? "bg-coral" : GUTTER[turn.role] ?? GUTTER.system}`}
              aria-hidden
            />
            <div className="text-meta uppercase text-stone-400">{t(`roles.${role}`)}</div>
            <p
              className={`mt-1 whitespace-pre-wrap text-body leading-7 ${
                turn.role === "system" ? "text-steel" : "text-ink"
              } ${flash === index ? "animate-arrive-in" : ""}`}
            >
              {compacted > 0 ? t("compactedNote", { count: compacted }) : turn.text}
            </p>
            {choices ? (
              <JdsIntakeChoiceCards
                set={choices}
                disabled={closed || sending || index !== lastIndex}
                onPick={onSend}
                onDecline={onDeclineChoices}
              />
            ) : null}
          </motion.div>
        );
      })}

      <AnimatePresence initial={false}>
        {sending ? (
          <motion.div
            key="thinking"
            initial={{ opacity: reduced ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: ATELIER_EASE }}
            className="relative pl-4"
          >
            <motion.span
              layoutId={pendingId}
              transition={reduced ? { duration: 0 } : ATELIER_SPRING}
              className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-coral"
              aria-hidden
            />
            <div className="text-meta uppercase text-stone-400">{t("roles.agent")}</div>
            <p className="mt-1 text-body leading-7 text-steel">{t("thinking")}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {statusNote ? (
          <motion.p
            key="statusNote"
            initial={{ opacity: reduced ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: ATELIER_EASE }}
            className="pl-4 text-meta text-steel"
          >
            {statusNote}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Scroll-to + a short flash for a cited turn, then control returns to the
 *  caller. Same 1.6 s contract the shared transcript used, kept so a brief
 *  citation behaves identically under every coat. */
function useFlash(turn: number | null | undefined, onDone?: () => void): number | null {
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (turn == null) return;
    const start = window.setTimeout(() => setFlash(turn), 0);
    const end = window.setTimeout(() => {
      setFlash(null);
      onDone?.();
    }, 1600);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [turn, onDone]);
  return flash;
}
