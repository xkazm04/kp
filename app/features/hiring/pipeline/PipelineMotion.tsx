"use client";

// The board page's presence motion — the four shapes every "this section comes and
// goes" moment on the Pipeline tab uses.
//
// The page is built out of surfaces that appear and vanish as the day's work
// changes or a mode is armed: the attention strip, the Today rail, the saved-view
// strip, the bulk-action bar, the SLA editor, the no-match message, the move-error
// alert. Every one of them used to hard-cut — the row simply existed on one frame
// and not on the next, which on a dense board reads as a layout glitch rather than
// as a change. These wrap that in the app's established framer-motion idiom
// (AnimatePresence + reduced-motion gate, the segmented-control standard set in
// AnalyzeWorkspace.tsx).
//
// Fade       — a section that occupies its own slot in the page flow (rise + fade).
// Collapse   — a strip that opens INSIDE a panel and must push the rows below it
//              down as it grows (height + fade), never overlap them.
// FadeSwap   — two mutually-exclusive contents trading places in one slot.
// FadeInline — a control blinking in and out of a toolbar row.
//
// They render NOTHING (no wrapper element) while hidden, which is load-bearing:
// the tab's column is a `space-y-8` stack, so an always-present empty wrapper
// would add a permanent 2rem gap where the section isn't. AnimatePresence emits no
// DOM of its own, so a hidden section costs no box.
//
// Consequence for callers: a self-hiding component (one that returns null when it
// has nothing to show) must own its own <Fade> INTERNALLY — a parent wrapper can
// only animate what it can still render during the exit, and a component that has
// already returned null gives it nothing to fade out.

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Fade (+ small rise) a section in and out of the page flow. */
export function Fade({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  /** Applied to the motion wrapper — keep it layout-only (the child owns its skin). */
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        // A constant key is all AnimatePresence needs to track a single
        // conditional child — and while it exits, the copy it holds is the LAST
        // RENDERED one, so a section whose content came from now-cleared state
        // (the move-error text) still fades out reading what it read.
        <motion.div
          key="on"
          className={className}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Open/close a strip inside a panel: height animates so the content below is
 *  pushed rather than covered. `overflow-hidden` is on the wrapper, so a child
 *  with an escaping popup (a portalled menu) is unaffected but an inline one
 *  would clip — the strips using this have neither. */
export function Collapse({ show, children }: { show: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="on"
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.24, ease: EASE }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Crossfade between two mutually-exclusive contents in the SAME slot (the board
 *  vs the "nothing matches" message). `mode="wait"` sequences them — the outgoing
 *  one is gone before the incoming one mounts — so the two never stack and shove
 *  the panel around mid-transition. Same idiom as the segmented-control standard
 *  in AnalyzeWorkspace.tsx. */
export function FadeSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={swapKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.1 : 0.16, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Inline control that blinks in and out of a toolbar row (the result count, the
 *  Clear button, Save view). Scales from 96% so it reads as arriving in place
 *  rather than sliding the row around. The wrapper is a real inline-flex box, not
 *  `display: contents` — a contents box generates no frame, so opacity/scale
 *  would have nothing to apply to. */
export function FadeInline({ show, children }: { show: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.span
          key="on"
          className="inline-flex min-w-0 items-center"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
