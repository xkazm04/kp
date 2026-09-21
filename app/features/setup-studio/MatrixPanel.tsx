"use client";

/*
 * The capability matrix — the deliverable of every run, and on an already-set-up
 * machine the ONLY thing a run produces.
 *
 * Four states, four tones, and the distinctions matter more than the colours:
 *   on        — it works
 *   degraded  — it works with a caveat the operator must know ("queued-only",
 *               "link-based", "open (dev)"); a fallback that says so is a
 *               product property here, not a failure
 *   hidden    — the feature is not shown because nothing configures it
 *   off       — configured to be off, or refused
 *
 * Every off/hidden row is a group the operator could still add, so the end of a
 * run is an invitation rather than a full stop: each becomes a button that
 * injects a plain user turn (`POST /message`), which the agent answers by
 * declaring a NEW plan — absorbed by the rail without losing what is ticked.
 * Those buttons ride a channel that only exists while the session does, so they
 * disable themselves the moment the run ends.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, PartyPopper, Plus } from "lucide-react";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, DIVIDER, PANEL } from "@/app/_components/ui/recipes";
import { plainName, type Matrix, type MatrixState } from "./protocol";
import { Prose, inlineMarkdown } from "./StudioBits";
import { COPY } from "./copy";

/**
 * A matrix state is a qualitative signal, which is exactly what `Badge` is for —
 * so the chip is the shared primitive with a tone, not four hand-typed class
 * strings. `hidden` is `muted` rather than a fifth tone: "you never configured
 * this" should recede, not compete with the rows that are actually doing
 * something, and it must not read like the amber of a working-with-a-caveat row.
 */
const STATE_TONE: Record<MatrixState, { tone: BadgeTone; muted?: boolean }> = {
  on: { tone: "positive" },
  degraded: { tone: "caution" },
  hidden: { tone: "neutral", muted: true },
  off: { tone: "neutral" },
};

const CARD_EDGE: Record<MatrixState, string> = {
  on: "border-moss/30",
  degraded: "border-amber-300",
  hidden: "border-stone-200",
  off: "border-stone-200",
};

export function MatrixPanel({
  matrix,
  /** A run that asked nothing: the matrix IS the deliverable, so it says so. */
  reward,
  canAddOn,
  onAddOn,
  appPort,
}: {
  matrix: Matrix;
  reward: boolean;
  canAddOn: boolean;
  onAddOn: (name: string) => void;
  appPort: number | null;
}) {
  const reduced = useReducedMotion();
  const [asked, setAsked] = useState<string[]>([]);
  const addOns = matrix.rows
    .filter((r) => r.state === "off" || r.state === "hidden")
    .map((r) => plainName(r.name))
    .slice(0, 4);

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.35, ease: "easeOut" }}
      className={`${PANEL} ${CARD_PAD}`}
    >
      <h2 className="flex items-center gap-2 font-serif text-display text-ink">
        <PartyPopper size={22} aria-hidden className="text-coral" />
        {reward ? COPY.rewardTitle : COPY.doneTitle}
      </h2>
      {reward ? <p className="mt-1 text-body text-steel">{COPY.rewardNote}</p> : null}

      {matrix.prose ? (
        <p className="mt-3 whitespace-pre-line text-body text-steel">
          <Prose text={matrix.prose} />
        </p>
      ) : null}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {matrix.rows.map((row, i) => (
            <motion.div
              key={row.name}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.25, delay: reduced ? 0 : Math.min(i, 8) * 0.04 }}
              className={`rounded-lg border bg-white p-3 dark:rounded-2xl ${CARD_EDGE[row.state]}`}
              data-matrix-state={row.state}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base font-semibold text-ink">{inlineMarkdown(row.name)}</span>
                <Badge {...STATE_TONE[row.state]} label={row.stateText} />
              </div>
              {row.extra.map((cell) => (
                <p key={cell.key} className="mt-1 text-sm text-steel">
                  <span className="font-semibold text-ink">{cell.key}: </span>
                  <Prose text={cell.value} />
                </p>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <p className="mt-4 text-sm text-steel">{COPY.doneNote}</p>

      {addOns.length ? (
        <div className={`${DIVIDER} mt-4 pt-4`}>
          <p className="text-base font-semibold text-ink">{COPY.addonTitle}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {addOns.map((name) => {
              const done = asked.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={done || !canAddOn}
                  onClick={() => {
                    setAsked((prev) => [...prev, name]);
                    onAddOn(name);
                  }}
                  className={`${BTN_SECONDARY} h-9 px-3`}
                >
                  <Plus size={14} aria-hidden />
                  {done ? `${COPY.addonAsked} ${name}` : `${COPY.addonPrefix} ${name}`}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* The hand-off. Capability setup ends here; the workspace's own first-run
          flow (company → team → pipeline → Candi) is the next thing, and the two
          are deliberately one journey with one visual language. The restart note
          rides with it because an env value written this session does not reach
          a server that was already running — the classic false "it works". */}
      <div className={`${DIVIDER} mt-4 pt-4`}>
        <p className="font-serif text-h2 text-ink">{COPY.handoffTitle}</p>
        <p className="mt-1 text-body text-steel">{COPY.handoffBody}</p>
        <p className="mt-2 text-sm text-steel">{COPY.restartNote}</p>
        {appPort ? (
          <a
            href={`http://localhost:${appPort}/`}
            target="_blank"
            rel="noopener"
            className={`${BTN_PRIMARY} mt-3 h-10 px-5`}
          >
            {COPY.handoffCta}
            <ArrowRight size={16} aria-hidden />
          </a>
        ) : (
          <Link href="/" className={`${BTN_PRIMARY} mt-3 h-10 px-5`}>
            {COPY.handoffCta}
            <ArrowRight size={16} aria-hidden />
          </Link>
        )}
      </div>
    </motion.section>
  );
}
