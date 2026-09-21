"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { diffBrief, EMPTY_DELTA, type BriefDelta } from "./intakeDelta";

// PER-TURN ARRIVAL — the studio's answer to "what did my last sentence buy?".
//
// The reveal (`briefReveal.ts` / `BriefRevealAtoms.tsx`) already writes the WORDS
// inside a line that just landed. It cannot say which ROWS moved, because it
// classifies rendered line keys and a row can change without its sentence
// changing (a re-grading) or change its sentence without being a new row (a
// rename). `intakeDelta.ts` answers that question over the brief's own arrays;
// this file is the motion for it, and the division is strict:
//
//   arrival  = the ROW enters, staggered, carrying the turn it came from
//   reveal   = the TEXT inside the row types itself out
//
// Both run on the same landing, and neither duplicates the other. So a row does
// not fade its own text in as well as sliding in — `ArrivalList` animates the
// list item, `TypedText` animates the sentence, and the row's `data-source-turn`
// is what connects it back to the transcript.
//
// Motion follows the house idiom (AnalyzeWorkspace / PipelineMotion): framer
// `AnimatePresence` + the shared spring, gated by `useReducedMotion` — where
// arrival collapses to "the row is simply there", no stagger and no transform,
// because a staggered cascade is precisely the motion that preference asks us to
// stop.

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
/** 40 ms apart, and only for the first dozen. A twenty-row extraction staggered
 *  end to end would hold the last row back most of a second after the reply is
 *  already readable — the cascade is a cue, not a loading bar. */
const STAGGER_MS = 40;
const STAGGER_CAP = 12;

export type ArrivalDelta = {
  /** Row identities this turn ADDED. */
  arriving: ReadonlySet<string>;
  /** Row identities this turn rewrote in place. */
  changed: ReadonlySet<string>;
  /** Stagger position among the arriving rows; -1 when the row is not arriving. */
  orderOf: (id: string) => number;
};

const NO_ARRIVAL: ArrivalDelta = { arriving: new Set(), changed: new Set(), orderOf: () => -1 };

/** How long the arrival state stays live. Past this the delta clears, so a row
 *  that lands and then sits there is not permanently marked "new" — and a
 *  re-render for any other reason (opening the edit form, folding a leaf) cannot
 *  replay the cascade. */
const ARRIVAL_WINDOW_MS = 1400;

/**
 * The previous brief snapshot, and the delta the newest one produced.
 *
 * The FIRST snapshot this hook sees is history, whatever its age — the same rule
 * `useBriefReveal` applies for the same reason: opening a finished session must
 * not animate nineteen turns' worth of work as if it had just arrived. Only a
 * snapshot that REPLACES one is a turn.
 */
export function useArrivalDelta(brief: RoleBrief | null): ArrivalDelta {
  // `undefined` = nothing seen yet (distinct from `null`, which is a real brief
  // state: a session with no extraction yet).
  const seen = useRef<RoleBrief | null | undefined>(undefined);
  const [delta, setDelta] = useState<BriefDelta>(EMPTY_DELTA);

  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = brief;
      return;
    }
    if (seen.current === brief) return;
    const next = diffBrief(seen.current, brief ?? {});
    seen.current = brief;
    setDelta(next);
    const timer = window.setTimeout(() => setDelta(EMPTY_DELTA), ARRIVAL_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [brief]);

  return useMemo(() => {
    if (delta === EMPTY_DELTA) return NO_ARRIVAL;
    const order = new Map(delta.added.map((r, i) => [r.key, i]));
    return {
      arriving: new Set(delta.added.map((r) => r.key)),
      changed: new Set(delta.changed.map((r) => r.key)),
      orderOf: (id: string) => order.get(id) ?? -1,
    };
  }, [delta]);
}

/**
 * A list whose rows know whether they just arrived.
 *
 * `keyOf` is React's identity (the render walk's own line key); `idOf` is the
 * DELTA's identity for the same row — they are different on purpose, because the
 * render key encodes duplicates and section membership while the delta keys rows
 * by what the engine calls them. `sourceTurnOf` puts the citation on the element
 * as `data-source-turn`, which is both the hook a test can read and, for an
 * arriving row, the click target that jumps the transcript.
 *
 * A CHANGED row is re-keyed (`…:changed`) so the CSS `animate-arrive-in` replays:
 * a class only animates on element creation, and a row whose grading moved keeps
 * the same identity by construction.
 */
export function ArrivalList<T>({
  items,
  keyOf,
  idOf,
  sourceTurnOf,
  renderItem,
  delta,
  itemClassName,
  onJumpToTurn,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  idOf: (item: T) => string;
  sourceTurnOf?: (item: T) => number | null;
  renderItem: (item: T) => ReactNode;
  delta: ArrivalDelta;
  itemClassName?: string;
  /** Clicking a row that just arrived scrolls the transcript to the turn it came
   *  from. Mouse convenience only — the keyboard path is the row's own turn chip
   *  (`TurnRef`), which is a real button and calls the same handler. */
  onJumpToTurn?: (turn: number) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {items.map((item) => {
        const id = idOf(item);
        const order = delta.orderOf(id);
        const isNew = order >= 0;
        const isChanged = delta.changed.has(id);
        const turn = sourceTurnOf?.(item) ?? null;
        const jump = isNew && turn !== null && onJumpToTurn ? () => onJumpToTurn(turn) : undefined;
        return (
          <motion.li
            key={`${keyOf(item)}${isChanged ? ":changed" : ""}`}
            data-source-turn={turn ?? undefined}
            onClick={jump}
            className={`${itemClassName ?? ""}${isChanged ? " animate-arrive-in" : ""}${jump ? " cursor-pointer" : ""}`}
            initial={isNew && !reduced ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: reduced ? 1 : 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { ...SPRING, delay: isNew && order < STAGGER_CAP ? (order * STAGGER_MS) / 1000 : 0 }
            }
          >
            {renderItem(item)}
          </motion.li>
        );
      })}
    </AnimatePresence>
  );
}
