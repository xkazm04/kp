"use client";

import { AnimatePresence, motion } from "framer-motion";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { ConfidenceNote, ProvenanceDot, RationaleDisclosure, TurnRef } from "../../JdsIntakeBriefAtoms";
import { TypedText, type BriefReveal } from "../../BriefRevealAtoms";
import type { ArrivalDelta } from "../../IntakeArrivalMotion";
import type { BriefLine } from "../../briefSections";
import { CONSOLE_SPRING, CONSOLE_STAGGER_CAP, CONSOLE_STAGGER_MS } from "./consoleModel";

// ONE STACK OF THE DOSSIER — a captured condition is a CARD, not a bullet.
//
// The shipped brief is a marked-up list: one reading column of sentences with
// the evidence pushed into a right-hand margin. That is a good document. Console
// is not making a document — it is making a record that GROWS while you talk, and
// the unit of growth is the condition: one thing the requestor committed to, with
// the reading that produced it and the turn it came from, on its own card that
// lands on the stack it belongs to. The count on the stack head is then a real
// measurement ("four dealbreakers") rather than a bullet you have to tally.
//
// A card LANDS: it enters from above (`y: -8`) and springs into place, 40 ms
// apart, first dozen only. Downward is the direction a thing falls onto a pile,
// and it is deliberately the opposite of the shipped list's rise — the classic
// coat's rows arrive INTO a document, these arrive ONTO a stack.
//
// An EMPTY stack still draws itself: a dashed outline the size of one card. The
// shape of what will fill it, where the shipped panel wrote "The brief builds
// itself here as you talk" — a sentence promising a thing the outline shows.

export function ConsoleGhostCard() {
  return <div className="h-11 rounded-lg border border-dashed border-stone-200 dark:rounded-2xl" aria-hidden />;
}

function ConsoleCard({
  line,
  mode,
  learnableLabel,
  onJump,
}: {
  line: BriefLine;
  mode: BriefReveal["mode"];
  learnableLabel: string | null;
  onJump?: (turn: number) => void;
}) {
  return (
    <div className={`${PANEL} flex items-start justify-between gap-2 p-2.5`}>
      <div className="min-w-0">
        {line.label ? <div className="text-meta text-steel">{line.label}</div> : null}
        <TypedText
          text={line.text}
          mode={mode(line.key)}
          className={`text-body ${line.muted ? "text-steel" : "text-ink"}`}
        />
        {learnableLabel ? <span className="ml-1.5 text-meta text-amber-800">{learnableLabel}</span> : null}
        {/* Weight · confidence · rationale on demand — a card's defence, folded
            away until it is doubted. */}
        {line.requirement ? <RationaleDisclosure r={line.requirement} /> : null}
      </div>
      <span className="flex shrink-0 items-start gap-1.5 pt-0.5">
        <ProvenanceDot provenance={line.provenance} />
        <ConfidenceNote confidence={line.confidence} />
        {/* The citation is this coat's best link: pressing it opens that exchange
            on the timeline rail, so "why is this here" is answered by the words
            that put it there. */}
        <TurnRef turn={line.sourceTurn} onJump={onJump} />
      </span>
    </div>
  );
}

export function ConsoleDossierStack({
  hue,
  label,
  lines,
  mode,
  delta,
  learnableOf,
  onJumpToTurn,
  children,
}: {
  /** Colour is the STACK, never the card — the app's own contract. */
  hue: string;
  label: string;
  lines: readonly BriefLine[];
  mode: BriefReveal["mode"];
  delta: ArrivalDelta;
  learnableOf?: (line: BriefLine) => string | null;
  onJumpToTurn?: (turn: number) => void;
  /** The Role stack's own head card (title + seniority), which is not a line. */
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const empty = lines.length === 0 && !children;

  return (
    <section>
      <div className={`flex items-center gap-2 ${META_LABEL}`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${hue}`} aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        {lines.length > 0 ? <span className="text-stone-400 nums">{lines.length}</span> : null}
      </div>
      <div className="mt-2 space-y-1.5">
        {children}
        {empty ? <ConsoleGhostCard /> : null}
        <AnimatePresence initial={false}>
          {lines.map((line) => {
            const order = delta.orderOf(line.arrivalId);
            const isNew = order >= 0;
            const isChanged = delta.changed.has(line.arrivalId);
            return (
              <motion.div
                // A re-graded card keeps its identity, so the key carries the
                // change: a class only animates on element creation.
                key={`${line.key}${isChanged ? ":changed" : ""}`}
                initial={isNew && !reduced ? { opacity: 0, y: -8 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: reduced ? 1 : 0 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { ...CONSOLE_SPRING, delay: isNew && order < CONSOLE_STAGGER_CAP ? (order * CONSOLE_STAGGER_MS) / 1000 : 0 }
                }
                className={isChanged ? "animate-arrive-in" : undefined}
              >
                <ConsoleCard
                  line={line}
                  mode={mode}
                  learnableLabel={learnableOf?.(line) ?? null}
                  onJump={onJumpToTurn}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
