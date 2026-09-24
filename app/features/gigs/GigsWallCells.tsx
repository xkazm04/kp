"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { lintDraft, lintGate } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigArena, GigAttempt, GigKpiCell } from "@/app/_lib/gigs/types";
import { deadlineView, rateView, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { EdgeSwatch, edgeClass, markForGig, MarkLegend, MarkRow, OutcomeMark, type MarkKind } from "./GigsMarks";
import { useGigsFormat } from "./useGigsFormat";

// The pieces of the line (GigsWall.tsx): one card per gig, the sticky arena label that
// opens each row, the terminus that closes it, and the two empty cells that must never
// look alike - "none reached" (the arena never got here) and "none here now" (it did,
// and moved on).
//
// A card's FRAME carries provenance, so it is read without a lookup:
//   solid border      the listing stated its reward
//   dashed border     it did not ("reward not stated", in words, on the card too)
//   hatched + lock    suspect: quarantined, not dispatchable (in words, too)
//   left edge         the specialist who works it (EdgeSwatch, named in the row label)
// and its one flag names the next move in words: "1 blocker · 2 to check", "approved,
// not sent", "awaiting verdict · 3 days ago", a verdict with its mark.

/** Hatch for a suspect card: the card surface striped with the critical tint. Tokens
 *  only, so it re-skins in Spark Dark with the rest. */
const SUSPECT_HATCH =
  "border-red-400 bg-white [background-image:repeating-linear-gradient(-45deg,var(--color-red-50)_0px,var(--color-red-50)_6px,transparent_6px,transparent_12px)]";

/** "none reached": a recessed, hatched box - a hole in the line, not a pause in it. */
const VOID_HATCH =
  "bg-stone-50 [background-image:repeating-linear-gradient(45deg,var(--color-stone-200)_0px,var(--color-stone-200)_1px,transparent_1px,transparent_6px)]";

const FLAG = "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-snug";

type Flag = { text: string; tone: string; mark?: MarkKind };

function useCardFlag() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (gig: Gig, latest: GigAttempt | null, source: SourceRow | null, now: Date): Flag | null => {
    if (gig.status === "suspect") return null;
    const mark = markForGig(gig, latest);
    if (mark === "pending") {
      return { text: t("card.pending", { when: fmt.relative(latest?.sentAt ?? null, now) ?? t("recordView.unknownWait") }), tone: "border border-dashed border-blue-700 text-blue-700", mark };
    }
    if (mark) return { text: t(`mark.${mark}` as Parameters<typeof t>[0]), tone: "border border-stone-300 text-ink", mark };
    if (!latest) return null;
    switch (latest.status) {
      case "drafted": {
        const g = lintGate(lintDraft({ gig, attempt: latest, source, now }), new Set());
        if (g.blockers) return { text: t("card.blockers", { blockers: g.blockers, warns: g.warns }), tone: "bg-coral text-white" };
        if (g.warns) return { text: t("card.warns", { count: g.warns }), tone: "border border-coral text-coral" };
        return { text: t("card.review"), tone: "border border-coral text-coral" };
      }
      case "approved":
        return { text: t("card.approved"), tone: "border border-moss text-moss" };
      case "revision_requested":
        return { text: t("card.revision"), tone: "border border-stone-300 text-steel" };
      case "dispatched":
      case "running":
        return { text: t("card.running"), tone: "border border-dashed border-stone-300 text-steel" };
      case "failed":
        return { text: t("card.failed"), tone: "border border-coral text-coral" };
      default:
        return null;
    }
  };
}

export const GigCard = memo(function GigCard({
  gig,
  latest,
  source,
  specialist,
  edge,
  now,
  dim,
  hit,
  current,
  onOpen,
}: {
  gig: Gig;
  latest: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  /** The specialist's place in the edge vocabulary; -1 when nobody works it yet. */
  edge: number;
  now: Date;
  /** Outside the search or the filter: still there, still reachable, dimmed. */
  dim: boolean;
  /** A search match: lit. */
  hit: boolean;
  /** The card the operator last came back from. */
  current: boolean;
  onOpen: (gigId: string) => void;
}) {
  const t = useTranslations("gigs");
  const flagFor = useCardFlag();
  const flag = flagFor(gig, latest, source, now);
  const suspect = gig.status === "suspect";
  const d = deadlineView(gig.deadlineAt, now);
  const frame = suspect ? SUSPECT_HATCH : gig.reward ? "border-stone-200 bg-white" : "border-dashed border-stone-300 bg-white";
  const outline = current ? "outline outline-2 outline-offset-1 outline-ink" : hit ? "outline outline-2 outline-offset-1 outline-coral" : "";

  return (
    <button
      type="button"
      data-gig-card={gig.id}
      onClick={() => onOpen(gig.id)}
      aria-current={current ? "true" : undefined}
      className={`focus-ring relative block w-full rounded-md border py-1.5 pl-3.5 pr-2 text-left transition-[opacity,transform] hover:border-coral/60 dark:rounded-lg dark:border-2 dark:shadow-sticker-xs dark:odd:-rotate-[0.6deg] dark:even:rotate-[0.6deg] dark:hover:rotate-0 motion-reduce:transition-none ${frame} ${outline} ${dim ? "opacity-30" : ""}`}
    >
      <span aria-hidden className={`absolute inset-y-1 left-1 w-1.5 rounded-sm ${edgeClass(edge)}`} />
      <span className="line-clamp-3 break-words text-sm font-semibold leading-snug text-ink">{gig.title}</span>
      <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-steel">
        <span className="min-w-0 break-words">{gig.reward ? gig.reward.text : <span className="italic">{t("facts.rewardNotStated")}</span>}</span>
        {d.state === "passed" ? (
          <span className="font-semibold text-coral">{t("card.closed")}</span>
        ) : d.state === "soon" ? (
          <span className="font-semibold text-amber-700 nums">{t("card.daysLeft", { days: Math.max(0, d.days) })}</span>
        ) : d.state === "open" && d.days <= 14 ? (
          <span className="nums">{t("card.daysLeft", { days: d.days })}</span>
        ) : null}
      </span>
      {suspect ? (
        <span className="mt-1.5 flex items-start gap-1 text-xs font-semibold leading-snug text-red-700">
          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden /> {t("card.quarantined")}
        </span>
      ) : null}
      {flag ? (
        <span className={`${FLAG} ${flag.tone}`}>
          {flag.mark ? <OutcomeMark kind={flag.mark} /> : null}
          <span className="min-w-0 break-words">{flag.text}</span>
        </span>
      ) : null}
      {specialist ? <span className="sr-only">{t("card.by", { name: specialist.name })}</span> : null}
    </button>
  );
});

/** An empty cell. `reached`: the arena got here and moved on. Not reached: it never did. */
export function EmptyCell({ reached }: { reached: boolean }) {
  const t = useTranslations("gigs");
  if (reached) {
    return (
      <span className="flex items-center gap-2 px-1 py-2 text-xs text-steel">
        <span aria-hidden className="h-0 w-4 border-t border-stone-300" />
        {t("line.noneHere")}
      </span>
    );
  }
  return <span className={`${VOID_HATCH} block rounded-md border border-dashed border-stone-300 px-2 py-3 text-center text-xs italic text-steel`}>{t("line.noneReached")}</span>;
}

/** The row's sticky label: the arena, its specialists (each beside its edge, a door to
 *  its page), and its sources' state. */
export function LaneLabel({
  arena,
  total,
  specialists,
  edgeOf,
  sources,
  onOpenSpecialist,
  onHire,
}: {
  arena: GigArena;
  total: number;
  specialists: readonly SpecialistRow[];
  edgeOf: (id: string) => number;
  sources: readonly SourceRow[];
  onOpenSpecialist: (id: string) => void;
  onHire: (arena: GigArena) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
    <div className="space-y-3">
      <div>
        <p className="font-serif text-h3 leading-tight text-ink">{fmt.arena(arena)}</p>
        <p className="text-sm text-steel nums">{t("line.listings", { count: total })}</p>
      </div>
      <div>
        <p className={META_LABEL}>{t("line.specialistsLabel")}</p>
        {specialists.length === 0 ? (
          <p className="mt-1 text-sm text-steel">
            {t("line.noSpecialist")}{" "}
            <button type="button" onClick={() => onHire(arena)} className="focus-ring font-semibold text-coral hover:underline">
              {t("line.hireOne")}
            </button>
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {specialists.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSpecialist(s.id)}
                  className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 bg-paper px-2 py-1 text-left text-sm text-ink hover:border-coral/50 dark:rounded-lg"
                >
                  <EdgeSwatch index={edgeOf(s.id)} />
                  <span className="min-w-0 break-words">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className={META_LABEL}>{t("line.sourcesLabel")}</p>
        {sources.length === 0 ? (
          <p className="mt-1 text-sm text-steel">{t("line.noSource")}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {sources.map((s) => (
              <li key={s.id} className="break-words">
                <span className="font-mono text-ink">{s.host}</span>{" "}
                {s.enabled && !s.pausedReason ? (
                  <span className="text-steel">· {t("line.polling")}</span>
                ) : (
                  <span className="font-semibold text-amber-700">· {s.pausedReason ? fmt.paused(s.pausedReason) : t("sources.disabled")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Where a row ends: the arena's accepted-of-resolved with its n, pending apart, a mark
 *  per sent draft, and the cost per accepted - the server's own fold, never re-counted
 *  here. A door to the scorecard, opened on this arena. */
export function Terminus({ cell, marks, onOpenScorecard }: { cell: GigKpiCell | undefined; marks: MarkKind[]; onOpenScorecard: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const r = rateView(cell);
  return (
    <div className="space-y-2">
      <p className="font-serif text-h2 leading-none text-ink nums">{r.measured ? t("rate.fraction", { accepted: r.accepted, resolved: r.resolved }) : <span className="text-base italic text-steel">{t("rate.unmeasuredShort")}</span>}</p>
      {r.measured ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-steel nums">
          {t("rate.percentAtN", { percent: fmt.percent(r.percent ?? 0), n: r.resolved })}
          {r.small ? <span className={`${CHIP_QUIET} text-xs`}>{t("rate.small")}</span> : null}
        </p>
      ) : null}
      <MarkRow marks={marks} emptyLabel={t("scorecard.nothingSent")} />
      <p className="text-sm text-ink nums">{t("rate.pending", { count: r.pending })}</p>
      <p className="text-xs text-steel nums">
        {cell?.costPerAcceptedUsd == null ? t("line.noAcceptedCost") : t("line.costPerAccepted", { cost: fmt.usd(cell.costPerAcceptedUsd) })}
        {cell && cell.costUnreported > 0 ? ` · ${t("specialists.costUnreported", { count: cell.costUnreported })}` : null}
      </p>
      <button type="button" onClick={onOpenScorecard} className="focus-ring text-sm font-semibold text-coral hover:underline">
        {t("line.toScorecard")}
      </button>
    </div>
  );
}

/** The legend: marks by shape, card frames, the edge. Always on screen, never a hover. */
export function WallLegend() {
  const t = useTranslations("gigs");
  const swatch = "inline-block h-3.5 w-6 shrink-0 rounded-sm border";
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-steel" role="group" aria-label={t("legend.label")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-ink">{t("legend.marks")}</span>
        <MarkLegend />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-ink">{t("legend.cards")}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`${swatch} border-stone-300 bg-white`} />
          {t("legend.rewardStated")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`${swatch} border-dashed border-stone-400 bg-white`} />
          {t("legend.rewardNotStated")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`${swatch} ${SUSPECT_HATCH}`} />
          {t("legend.suspect")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <EdgeSwatch index={0} />
          {t("legend.edge")}
        </span>
      </div>
    </div>
  );
}
