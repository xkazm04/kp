"use client";

/*
 * What the assistant found, in two registers.
 *
 * ONE list serves both: while the run is assessing it wears the assessment's
 * title and note ("Looking at what's already here"), and outside that it is the
 * plain checks list. The difference is register, not machinery — a second
 * component would split one machine's findings across two lists.
 *
 * Rows materialise as they arrive, each with a short staggered entrance so the
 * panel reads as a machine noticing things rather than a table appearing. The
 * stagger is capped: it decorates the first handful and then stops, so a run
 * with twenty probes does not spend two seconds fading them in.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { BTN_GHOST, CARD_PAD, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { ProbeRow } from "./protocol";
import { ProbeGlyph, probeTone } from "./StudioBits";
import { COPY } from "./copy";

function ProbeLine({ row, index, animate }: { row: ProbeRow; index: number; animate: boolean }) {
  return (
    <motion.li
      layout={animate}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: animate ? 0.22 : 0, delay: animate ? Math.min(index, 6) * 0.035 : 0, ease: "easeOut" }}
      className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1.5"
    >
      <span className="self-center">
        <ProbeGlyph status={row.status} />
      </span>
      <span className="text-base font-semibold text-ink">{row.name}</span>
      <span className="min-w-0 flex-1 text-sm text-steel">{row.detail}</span>
      <Badge tone={probeTone(row.status)} label={row.status} />
    </motion.li>
  );
}

/** The live list, shown while probes are still landing. */
export function ProbePanel({ rows, assessing }: { rows: ProbeRow[]; assessing: boolean }) {
  const reduced = useReducedMotion();
  if (!rows.length) return null;
  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <h2 className="font-serif text-h2 text-ink">{assessing ? COPY.assessTitle : COPY.checksTitle}</h2>
      <p className="mt-1 text-sm text-steel">{assessing ? COPY.assessNote : COPY.checksNote}</p>
      <ul className="mt-3 divide-y divide-stone-200">
        <AnimatePresence initial={false}>
          {rows.map((row, i) => (
            <ProbeLine key={row.name} row={row} index={i} animate={!reduced} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/**
 * The collapsed assessment — the evidence line that sits ABOVE the journey card
 * once the findings have turned into a proposal. It leads with one honest
 * sentence, keeps the rows that are NOT fine (the ones the journey options are
 * about) and puts the full list one click away.
 */
export function AssessSummary({ headline, rows }: { headline: string; rows: ProbeRow[] }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const notable = rows.filter((r) => r.status !== "ok");
  return (
    <section className={`${PANEL_SUNKEN} p-4`}>
      <p className="text-base font-semibold text-ink">{headline}</p>
      {notable.length ? (
        <ul className="mt-2 space-y-1">
          {notable.map((row) => (
            <li key={row.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="self-center">
                <ProbeGlyph status={row.status} />
              </span>
              <span className="font-semibold text-ink">{row.name}</span>
              <span className="text-steel">{row.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`${BTN_GHOST} mt-2 h-8 px-2 text-sm`}
      >
        <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? COPY.assessLess : COPY.assessMore}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            key="all"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            className="overflow-hidden divide-y divide-stone-200"
          >
            {rows.map((row, i) => (
              <ProbeLine key={row.name} row={row} index={i} animate={false} />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
