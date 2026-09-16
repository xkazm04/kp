"use client";

// One card hanging off its branch. Redesigned 2026-09: no initials avatar any more —
// the candidate's FULL NAME leads every card at every density, with the score on
// the same line, and a tone stripe down the left edge carries the band colour the
// avatar ring used to. Roomy cards (spacious / regular) turn the score bars on their
// side (TicketEvidence.DimensionBars) so the name and score keep the head of the
// card; the minified cards (compact / micro) keep the small vertical chart.

import { FitTierBadge } from "@/app/_components/Badge";
import { PANEL } from "@/app/_components/ui/recipes";
import { clampPercent, scoreTone } from "@/app/_lib/format";
import type { useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import type { MatchResultView } from "@/app/features/shared/matchTypes";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { boardScoreOf } from "../mapAvatar";
import type { SalaryPoint } from "../mapSalary";
import { TONE_BAR, TONE_TEXT } from "../mapTone";
import type { CardTier } from "../mapTypes";
import type { MapMoney } from "../useMapMoney";
import { ORCHARD_COPY as COPY } from "./orchardCopy";
import { DimensionBars, MiniBarChart, SkillChips } from "./TicketEvidence";

/** Everything a ticket reads besides its own entry — bundled so the grid and the
 *  branches pass ONE prop down instead of eight. */
export type TicketDeps = {
  salaryById: ReadonlyMap<string, SalaryPoint>;
  matchByCandidate: ReadonlyMap<string, MatchResultView>;
  matchLoading: boolean;
  /** The card's own click → the candidate modal (cohort already bound). */
  openDetail: (e: Entry) => void;
  tierLabels: ReturnType<typeof useFitTierLabels>;
  money: MapMoney;
  /** An optional caption under the name (the rejected shelf's "Rejected at …"). */
  tag?: (e: Entry) => string | null;
};

export const TICKET_WIDTH: Record<CardTier, number> = {
  spacious: 264,
  regular: 212,
  compact: 148,
  micro: 120,
};

const SCORE_SIZE: Record<CardTier, string> = {
  spacious: "text-3xl",
  regular: "text-2xl",
  compact: "text-base",
  micro: "text-sm",
};

export function Ticket({ entry, tier, deps }: { entry: Entry; tier: CardTier; deps: TicketDeps }) {
  const match = entry.candidateId ? deps.matchByCandidate.get(entry.candidateId) : undefined;
  const salary = deps.salaryById.get(entry.id);
  const raw = match?.total ?? boardScoreOf(entry);
  const score = raw != null ? Math.round(clampPercent(raw)) : null;
  const tone = scoreTone(raw);
  const roomy = tier === "spacious" || tier === "regular";
  const salaryText = salary ? deps.money.point(salary.midpoint) : null;
  const dims = (match?.scoreBreakdown ?? []).slice(0, 5);
  const missing = match?.missingSkills?.length ?? 0;
  const loadingBars = deps.matchLoading && !match;
  const tag = deps.tag?.(entry) ?? null;

  return (
    <article className={`${PANEL} relative flex flex-col overflow-hidden`} style={{ width: TICKET_WIDTH[tier] }}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${TONE_BAR[tone]}`} />
      <button
        type="button"
        onClick={() => deps.openDetail(entry)}
        aria-label={COPY.ticketAria(entry.candidateLabel, score, salaryText)}
        aria-haspopup="dialog"
        className={`focus-ring flex flex-1 cursor-pointer flex-col text-left transition-colors hover:bg-stone-50 ${
          roomy ? "gap-2.5 py-3 pl-4 pr-3" : "gap-1.5 py-2 pl-3 pr-2"
        }`}
      >
        <span className="flex items-start justify-between gap-2">
          <span
            className={`min-w-0 break-words font-semibold text-ink ${roomy ? "text-sm leading-snug" : "text-xs leading-tight"}`}
          >
            {entry.candidateLabel}
          </span>
          <span className={`nums shrink-0 font-semibold leading-none ${TONE_TEXT[tone]} ${SCORE_SIZE[tier]}`}>
            {score ?? "—"}
          </span>
        </span>
        {tag ? (
          <span className="inline-flex w-fit rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">{tag}</span>
        ) : null}
        {salaryText || (roomy && tier === "spacious") ? (
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            {salaryText ? <span className="nums text-xs text-steel">~{salaryText}</span> : null}
            {tier === "spacious" ? <FitTierBadge tier={match?.fitTier} score={raw} labels={deps.tierLabels} /> : null}
          </span>
        ) : null}
        {roomy ? (
          <>
            <DimensionBars dims={dims} loading={loadingBars} />
            <SkillChips
              matched={match?.matchedSkills ?? []}
              missingLabel={missing > 0 ? COPY.missing(missing) : null}
              limit={tier === "spacious" ? 3 : 2}
            />
          </>
        ) : tier === "compact" ? (
          <MiniBarChart dims={dims} loading={loadingBars} />
        ) : null}
      </button>
    </article>
  );
}
