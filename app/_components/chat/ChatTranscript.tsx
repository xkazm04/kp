"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { ChatComposer } from "./ChatComposer";

/*
 * The shared conversation column — transcript bubbles + composer. Lifted from
 * JdsIntakeChat (the JD intake dialog) so the operator companion, intake, and any
 * later chat surface share ONE bubble geometry, one thinking/slow-hint contract,
 * and one send-failure recovery instead of three drifting copies.
 *
 * Register (unchanged from intake): one side speaks on the ink accent, the other
 * in a quiet stone surface (`text-white` flips by design in Spark Dark); calm
 * line-height, no avatars, no gamification. Which ROLE sits on which side is the
 * caller's decision — `side()` maps a role string to left / right / center, so
 * intake's interviewer|candidate|system and the companion's user|assistant both
 * work without this component knowing either vocabulary.
 *
 * Every string is a prop: this lives under app/_components, where i18n:check
 * forbids a literal accessible name and the caller owns the message namespace.
 */

export type ChatTurn = { id: string; role: string; content: string };
export type ChatSide = "left" | "right" | "center";

export type ChatLabels = {
  /** The waiting bubble while a turn is in flight. */
  thinking: string;
  /** Added under `thinking` after ~8s — names the real wait honestly. */
  thinkingSlow: string;
  placeholder: string;
  send: string;
  /** Placeholder once the conversation can take no more turns. */
  closed?: string;
  /** Accessible name for the transcript region. */
  transcriptLabel: string;
};

const SLOW_HINT_MS = 8000;

export function ChatTranscript({
  turns,
  side,
  labels,
  busy,
  closed = false,
  onSend,
  statusNote,
  composerSlot,
  renderTurnExtras,
  emptyState,
  highlightId,
  onHighlightDone,
  className = "h-[32rem]",
  dense = false,
  tall = false,
}: {
  turns: ChatTurn[];
  side: (role: string) => ChatSide;
  labels: ChatLabels;
  busy: boolean;
  closed?: boolean;
  /** Resolves false when the exchange did NOT land — the composer then hands the
   *  typed message back instead of losing it with the rolled-back bubble. */
  onSend: (message: string) => void | Promise<boolean>;
  /** A quiet line under the last turn about work happening OUTSIDE the dialog.
   *  Never stored — nothing said it. */
  statusNote?: string | null;
  /** Extra control beside Send (intake's voice input mode). */
  composerSlot?: ReactNode;
  /** Per-turn marginalia under the bubble — recall chips, a provenance strip.
   *  The caller keys off its own data, so no metadata rides through this type. */
  renderTurnExtras?: (turn: ChatTurn) => ReactNode;
  /** Shown instead of the bubble list while the transcript is empty. */
  emptyState?: ReactNode;
  /** Turn id to scroll to + flash (a citation elsewhere was clicked). */
  highlightId?: string | null;
  onHighlightDone?: () => void;
  className?: string;
  /** Console register: tighter bubbles and gaps for a dense ops surface. */
  dense?: boolean;
  tall?: boolean;
}) {
  const reduced = useReducedMotion();
  const slow = useSlowHint(busy);
  const flash = useHighlight(highlightId, onHighlightDone);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    // Keep the newest exchange in view as turns land.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length, busy]);

  useEffect(() => {
    if (!flash) return;
    turnRefs.current.get(flash)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [flash]);

  const pad = dense ? "px-3 py-2 text-sm" : "px-3.5 py-2.5 text-body";
  const fade = { duration: reduced ? 0 : 0.2, ease: "easeOut" } as const;

  return (
    <div className={`flex flex-col ${className}`}>
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto pr-1 ${dense ? "space-y-2" : "space-y-3"}`}
        aria-live="polite"
        aria-label={labels.transcriptLabel}
      >
        {turns.length === 0 && !busy && emptyState ? emptyState : null}
        {turns.map((turn) => {
          const where = side(turn.role);
          const setRef = (el: HTMLDivElement | null) => {
            if (el) turnRefs.current.set(turn.id, el);
            else turnRefs.current.delete(turn.id);
          };
          if (where === "center") {
            return (
              <motion.div key={turn.id} ref={setRef} initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={fade} className="flex justify-center">
                <span className="text-meta text-steel">— {turn.content} —</span>
              </motion.div>
            );
          }
          const bubble =
            where === "right"
              ? `max-w-[85%] whitespace-pre-wrap rounded-lg bg-ink ${pad} text-white dark:rounded-2xl`
              : `max-w-[85%] whitespace-pre-wrap rounded-lg bg-stone-100 ${pad} text-ink dark:rounded-2xl`;
          return (
            <motion.div
              key={turn.id}
              ref={setRef}
              initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={fade}
              className={where === "right" ? "flex flex-col items-end" : "flex flex-col items-start"}
            >
              <div className={`${bubble} transition-shadow${flash === turn.id ? " ring-2 ring-coral" : ""}`}>{turn.content}</div>
              {renderTurnExtras ? renderTurnExtras(turn) : null}
            </motion.div>
          );
        })}
        <AnimatePresence initial={false}>
          {busy ? (
            <motion.div key="thinking" initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={fade} className="flex justify-start">
              <div className={`rounded-lg bg-stone-100 ${pad} text-steel dark:rounded-2xl`}>
                {labels.thinking}
                {slow ? <div className="mt-1 text-meta text-steel">{labels.thinkingSlow}</div> : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {statusNote ? (
            <motion.div key="statusNote" initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduced ? 1 : 0 }} transition={fade} className="flex justify-center">
              <span className="text-meta text-steel">— {statusNote} —</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <ChatComposer labels={labels} busy={busy} closed={closed} onSend={onSend} slot={composerSlot} dense={dense} tall={tall} />
    </div>
  );
}

/** The 8s honesty beat. Static copy, no animation — reduced-motion safe by construction. */
function useSlowHint(busy: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const show = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => {
      window.clearTimeout(show);
      // Deferred a tick (the jdsHooks.ts pattern): no synchronous setState in a teardown.
      window.setTimeout(() => setSlow(false), 0);
    };
  }, [busy]);
  return slow;
}

/** Scroll-to + 1.6s flash for a cited turn, then hand control back to the caller. */
function useHighlight(id: string | null | undefined, onDone?: () => void): string | null {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (id == null) return;
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in the effect.
    const start = window.setTimeout(() => setFlash(id), 0);
    const end = window.setTimeout(() => {
      setFlash(null);
      onDone?.();
    }, 1600);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [id, onDone]);
  return flash;
}
