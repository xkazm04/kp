"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Square, Volume2 } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { compactedTurnCount } from "@/app/_lib/intake-transcript";
import type { StudioTurn } from "@/app/_lib/jobseeker/types";
import { StudioChoiceCards } from "./StudioChoiceCards";
import { STUDIO_EASE, STUDIO_SPRING } from "./StudioZone";
import { useStudioTranslations } from "./useStudioTranslations";

// THE CONVERSATION AS TURN BLOCKS ON THE PLANE.
//
// The bubble is what makes a working document read as a chat toy: two rounded
// lozenges alternating left and right, each one a little box inside the zone
// that was already a box. A block keeps every fact the bubble carried and
// spends no geometry on it — a 2px rule in the gutter says WHO (coral = the
// agent, steel = the reader, stone = the seam the system reports), a tiny
// uppercase mark repeats it in words for anyone the colour does not reach, and
// the sentence gets the full measure and a reading leading instead of 85% of
// the column and a lozenge.
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
//
// Strings: `<ns>.composer.transcriptLabel`, `<ns>.roles.*`, `<ns>.compactedNote`,
// `<ns>.thinking`, `<ns>.glyph.speak` (read-aloud, when a consumer wires it).

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

export type StudioTranscriptProps = {
  turns: StudioTurn[];
  /** Turn index of the latest reply, for the arrival animation and read-aloud.
   *  Only this turn's choice cards are live. */
  latestIndex: number | null;
  /** A choice-card pick sends an ordinary message; "none of these" hands focus back.
   *  A consumer whose send resolves `false` (the exchange did not land) may return
   *  it — the cards keep the selection to retry (StudioChoiceCards reads the
   *  outcome when there is one). Widened in WP2 so the seeker's `send` (which
   *  answers `Promise<boolean>`) types without a wrapper. */
  onPick(message: string): void | boolean | Promise<boolean | void>;
  onDecline(): void;
  sending: boolean;
  ns: string;
  /** Read-aloud button per interviewer turn (null hides it). */
  onSpeak?: ((text: string, turnIndex: number) => void) | null;
  speakingIndex?: number | null;
  /** The session is finished: cards are a record, never an offer. */
  closed?: boolean;
  /** A cited turn to scroll to and flash (1.6 s), then `onHighlightDone`. */
  highlightTurn?: number | null;
  onHighlightDone?: () => void;
  /** A quiet line under the newest turn — what a background job is doing. */
  statusNote?: string | null;
};

export function StudioTranscript({
  turns,
  latestIndex,
  onPick,
  onDecline,
  sending,
  ns,
  onSpeak = null,
  speakingIndex = null,
  closed = false,
  highlightTurn,
  onHighlightDone,
  statusNote,
}: StudioTranscriptProps) {
  const t = useStudioTranslations(ns);
  const reduced = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef(new Map<number, HTMLDivElement>());
  const flash = useFlash(highlightTurn, onHighlightDone);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atFoot = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
    if (atFoot) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, sending]);

  useEffect(() => {
    if (flash == null) return;
    turnRefs.current.get(flash)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [flash]);

  const lastIndex = latestIndex ?? -1;
  // The slot the reply will land in — shared by the waiting mark and, once it
  // lands, by the turn itself.
  const pendingId = `atelier-turn-${turns.length}`;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 space-y-5 overflow-y-auto pl-0.5 pr-1"
      aria-live="polite"
      aria-label={t("composer.transcriptLabel")}
    >
      {turns.map((turn, index) => {
        const compacted = compactedTurnCount({ role: turn.role, text: turn.text });
        const role = ROLE_KEY[turn.role] ?? "system";
        const choices = turn.choices;
        const morph = index === lastIndex && turn.role === "interviewer";
        const speakable = onSpeak && turn.role === "interviewer" && turn.text.trim() ? turn.text : null;
        return (
          <motion.div
            key={index}
            ref={(el) => {
              if (el) turnRefs.current.set(index, el);
              else turnRefs.current.delete(index);
            }}
            initial={{ opacity: reduced ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: STUDIO_EASE }}
            className="relative pl-4"
          >
            <motion.span
              layoutId={morph ? `atelier-turn-${index}` : undefined}
              transition={reduced ? { duration: 0 } : STUDIO_SPRING}
              className={`absolute inset-y-0 left-0 w-0.5 rounded-full ${flash === index ? "bg-coral" : GUTTER[turn.role] ?? GUTTER.system}`}
              aria-hidden
            />
            {/* The block shape when no consumer wires read-aloud — the first
                consumer's exact markup; the flex row only exists for the glyph. */}
            <div className={`text-meta uppercase text-stone-400 ${speakable ? "flex items-center gap-1" : ""}`}>
              {t(`roles.${role}`)}
              {speakable ? (
                <IconAction
                  icon={speakingIndex === index ? Square : Volume2}
                  label={speakingIndex === index ? t("voiceIo.speaking") : t("glyph.speak")}
                  toggle
                  on={speakingIndex === index}
                  size={13}
                  onClick={() => onSpeak?.(speakable, index)}
                />
              ) : null}
            </div>
            <p
              className={`mt-1 whitespace-pre-wrap text-body leading-7 ${
                turn.role === "system" ? "text-steel" : "text-ink"
              } ${flash === index ? "animate-arrive-in" : ""}`}
            >
              {compacted > 0 ? t("compactedNote", { count: compacted }) : turn.text}
            </p>
            {choices ? (
              <StudioChoiceCards
                set={choices}
                disabled={closed || sending || index !== lastIndex}
                onPick={onPick}
                onDecline={onDecline}
                ns={ns}
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
            transition={{ duration: reduced ? 0 : 0.18, ease: STUDIO_EASE }}
            className="relative pl-4"
          >
            <motion.span
              layoutId={pendingId}
              transition={reduced ? { duration: 0 } : STUDIO_SPRING}
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
            transition={{ duration: reduced ? 0 : 0.18, ease: STUDIO_EASE }}
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
 *  caller. The 1.6 s contract every studio shares, so a citation behaves
 *  identically under every consumer. */
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
