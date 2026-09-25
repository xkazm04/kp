"use client";

import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import type { Gig, GigAttempt, GigDifficulty, GigKpiCell } from "@/app/_lib/gigs/types";
import { difficultyBars, rateView } from "./gigsLogic";
import { useGigsFormat } from "./useGigsFormat";

// The tab's small visual vocabulary, in one place so every screen draws it the same way.
//
// Outcome marks. Each verdict differs by SHAPE, not only by colour, so the record reads
// in greyscale and to a colour-blind reader: accepted is a filled disc, rejected a ring
// struck through, duplicate two rings, no response a dotted ring, pending a dashed ring.
// Colour rides along (moss / coral / amber / steel) as a second channel.
//
// The rate line: a fraction first ("3 of 7"), the percentage only beside its n, pending
// counted apart and never folded in, a small sample flagged as one.
//
// The specialist edge: the strip down a card's left edge that names who works it. Six
// tones, and three patterns cycling through them (solid, dashed, a double rule), so two
// specialists are told apart by shape as well as hue. Each arena's label on the line
// names its specialists beside the same strip, so the edge is never a lookup.

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
 *  rejection, so at this level it reads as one; the gig's page shows the verdict itself. */
export function markForGig(gig: Gig, latest: GigAttempt | null): MarkKind | null {
  if (!latest || latest.status !== "sent") return null;
  if (gig.status === "accepted") return "accepted";
  if (gig.status === "rejected") return "rejected";
  if (gig.status === "expired") return "no_response";
  if (gig.status === "sent") return "pending";
  return null;
}

/** Marks for every gig whose latest attempt was sent, oldest sent first. */
export function sentMarks(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, filter?: (g: Gig, a: GigAttempt) => boolean): MarkKind[] {
  return gigs
    .map((g) => ({ g, a: attemptsByGig[g.id] ?? null }))
    .filter((x): x is { g: Gig; a: GigAttempt } => x.a !== null && x.a.status === "sent" && (!filter || filter(x.g, x.a)))
    .sort((x, y) => ((x.a.sentAt ?? "") < (y.a.sentAt ?? "") ? -1 : 1))
    .map((x) => markForGig(x.g, x.a))
    .filter((m): m is MarkKind => m !== null);
}

/** A row of marks, oldest first, with one spoken summary for assistive tech. */
export function MarkRow({ marks, emptyLabel }: { marks: MarkKind[]; emptyLabel: string }) {
  const t = useTranslations("gigs");
  if (marks.length === 0) return <span className="text-sm text-steel">{emptyLabel}</span>;
  const spoken = marks.map((m) => t(`mark.${m}` as Parameters<typeof t>[0])).join(", ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1" role="img" aria-label={spoken}>
      {marks.map((m, i) => (
        <OutcomeMark key={i} kind={m} />
      ))}
    </span>
  );
}

export function MarkLegend() {
  const t = useTranslations("gigs");
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-steel" aria-label={t("mark.legend")}>
      {MARK_KINDS.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <OutcomeMark kind={k} />
          {t(`mark.${k}` as Parameters<typeof t>[0])}
        </li>
      ))}
    </ul>
  );
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
      {r.measured && r.small ? <span className={`${CHIP_QUIET} text-xs`}>{t("rate.small")}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The specialist edge
// ---------------------------------------------------------------------------

/** Tone + pattern, as whole class strings so Tailwind sees every one. The dashed rule is
 *  the tone under a stripe of the card's own surface; the double rule is two borders
 *  around a gap. Every colour is a token that follows the theme. */
const EDGES = [
  "bg-steel",
  "bg-moss [background-image:repeating-linear-gradient(180deg,transparent_0px,transparent_5px,var(--color-white)_5px,var(--color-white)_8px)]",
  "border-x-2 border-dial-amber",
  "bg-ink",
  "bg-blue-700 [background-image:repeating-linear-gradient(180deg,transparent_0px,transparent_5px,var(--color-white)_5px,var(--color-white)_8px)]",
  "border-x-2 border-stone-400",
] as const;

/** Unassigned: a hairline in the card's own border colour. */
const NO_EDGE = "bg-stone-200";

export function edgeClass(index: number): string {
  return index < 0 ? NO_EDGE : EDGES[index % EDGES.length];
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export const DIFFICULTY_ORDER = ["easy", "moderate", "hard", "very_hard", "unrated"] as const satisfies readonly GigDifficulty[];

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

/** The strip on its own, for a label or a legend: same width, same pattern. */
export function EdgeSwatch({ index, className = "" }: { index: number; className?: string }) {
  return <span aria-hidden className={`inline-block h-4 w-1.5 shrink-0 rounded-sm ${edgeClass(index)} ${className}`} />;
}
