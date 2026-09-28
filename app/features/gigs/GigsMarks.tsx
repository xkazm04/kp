"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import type { Gig, GigAttempt, GigDifficulty, GigKpiCell } from "@/app/_lib/gigs/types";
import { difficultyBars, rateView } from "./gigsLogic";
import { useGigsFormat } from "./useGigsFormat";

// The tab's small visual vocabulary for outcomes and difficulty, in one place so every
// screen draws it the same way.
//
// Outcome marks. Each verdict differs by SHAPE, not only by colour, so the record reads
// in greyscale and to a colour-blind reader: accepted is a filled disc, rejected a ring
// struck through, duplicate two rings, no response a dotted ring, pending a dashed ring.
// Colour rides along (moss / coral / amber / steel) as a second channel.
//
// The rate line: a fraction first ("3 of 7"), the percentage only beside its n, pending
// counted apart and never folded in, a small sample flagged as one.

export const MARK_KINDS = ["accepted", "rejected", "duplicate", "no_response", "pending"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

const TONE: Record<MarkKind, string> = {
  accepted: "text-moss",
  rejected: "text-coral",
  duplicate: "text-dial-amber",
  no_response: "text-steel",
  pending: "text-steel",
};

export function OutcomeMark({ kind, className = "" }: { kind: MarkKind; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`inline-block h-3 w-3 shrink-0 ${TONE[kind]} ${className}`} aria-hidden focusable="false">
      {kind === "accepted" ? <circle cx="6" cy="6" r="5" fill="currentColor" /> : null}
      {kind === "rejected" ? (
        <>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="2.5" y1="9.5" x2="9.5" y2="2.5" stroke="currentColor" strokeWidth="1.6" />
        </>
      ) : null}
      {kind === "duplicate" ? (
        <>
          <circle cx="4.5" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7.5" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </>
      ) : null}
      {kind === "no_response" ? <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="0.1 2.4" strokeLinecap="round" /> : null}
      {kind === "pending" ? <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.6" /> : null}
    </svg>
  );
}

/** The mark a gig's latest SENT attempt earns, read off the gig's status (the verdict
 *  path moves sent -> accepted | rejected | expired). A duplicate is stored as a
 *  rejection, so at this level it reads as one; the gig's proof shows the verdict itself. */
export function markForGig(gig: Gig, latest: GigAttempt | null): MarkKind | null {
  if (!latest || latest.status !== "sent") return null;
  if (gig.status === "accepted") return "accepted";
  if (gig.status === "rejected") return "rejected";
  if (gig.status === "expired") return "no_response";
  if (gig.status === "sent") return "pending";
  return null;
}

/** `lead={false}` drops the fraction (or "unmeasured") when a headline above already states it. */
export function RateLine({ cell, compact = false, lead = true }: { cell: GigKpiCell | null | undefined; compact?: boolean; lead?: boolean }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const r = rateView(cell);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 nums">
      {r.measured ? (
        <>
          {lead ? <span className="font-semibold text-ink">{t("rate.fraction", { accepted: r.accepted, resolved: r.resolved })}</span> : null}
          {compact ? null : <span className="text-sm text-steel">{t("rate.percentAtN", { percent: fmt.percent(r.percent ?? 0), n: r.resolved })}</span>}
        </>
      ) : lead ? (
        <span className="text-sm italic text-steel">{t("rate.unmeasured")}</span>
      ) : null}
      <span className="text-sm text-steel">{t("rate.pending", { count: r.pending })}</span>
      {r.measured && r.small ? <span className={`${CHIP_QUIET} text-sm`}>{t("rate.small")}</span> : null}
    </span>
  );
}

const DIFFICULTY_TONE: Record<GigDifficulty, string> = {
  easy: "text-moss",
  moderate: "text-dial-amber",
  hard: "text-coral",
  very_hard: "text-coral",
  unrated: "text-steel",
};

/** Four ascending bars, filled up to the level: read by COUNT and shape, colour second.
 *  `unrated` is four hollow dashed bars - an absence, never drawn like "easy". */
export function DifficultyGlyph({ difficulty, className = "" }: { difficulty: GigDifficulty; className?: string }) {
  const filled = difficultyBars(difficulty);
  const unrated = difficulty === "unrated";
  return (
    <svg viewBox="0 0 16 12" className={`inline-block h-3 w-4 shrink-0 ${DIFFICULTY_TONE[difficulty]} ${className}`} aria-hidden focusable="false">
      {[0, 1, 2, 3].map((i) => {
        const h = 3 + i * 2.6;
        const on = i < filled;
        return (
          <rect
            key={i}
            x={0.75 + i * 3.8}
            y={11.25 - h}
            width={2.8}
            height={h}
            rx={0.4}
            fill={on ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={on ? 0 : 0.9}
            strokeDasharray={unrated ? "1.2 1" : undefined}
            opacity={on || unrated ? 1 : 0.5}
          />
        );
      })}
    </svg>
  );
}
