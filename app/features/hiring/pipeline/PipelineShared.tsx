"use client";

// Small shared board/drawer display bits: the per-event glyph dot and the
// board's archetype/status legend. The event taxonomy (icon/tone catalog +
// useEventVerb/useRelativeTime) now lives in pipelineEventCatalog.ts, and the
// candidate row lives in PipelineCandidateRow.tsx — both re-exported here so
// existing "./PipelineShared" imports keep working.

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ARCHETYPE_STYLE } from "@/app/features/shared/pipelineTypes";
import { EVENT_CATALOG, EVENT_FALLBACK, isEventKind } from "./pipelineEventCatalog";

export {
  EVENT_KINDS,
  EVENT_CATALOG,
  isEventKind,
  useEventVerb,
  useRelativeTime,
  type EventKind,
} from "./pipelineEventCatalog";
export { CandidateRow } from "./PipelineCandidateRow";

export function EventDot({ kind }: { kind: string }) {
  const { Icon, tone } = isEventKind(kind) ? EVENT_CATALOG[kind] : EVENT_FALLBACK;
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />;
}

/** ONE THREAD (gap 2) — the board's ONE score legend.
 *
 *  Four different 0-100 numbers and one 1..5 rubric were rendered on this surface
 *  in the same shape, and the recruiter had no way to tell which question any of
 *  them answered — the worst case being a work-sample transfer score printed as a
 *  plain "match" because promote had written it into `match_score`. The numbers are
 *  now separated at the source (match-score.ts); this is where the vocabulary that
 *  separates them is stated once, next to the board that uses it, rather than in
 *  three tooltips a reader has to find. */
function ScoreKindLegend() {
  const t = useTranslations("pipeline");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-steel">
      <span className="font-medium text-ink">{t("legend.scoresTitle")}</span>
      <span>{t("legend.scoreMatch")}</span>
      <span>{t("legend.scoreTransfer")}</span>
      <span>{t("legend.scoreInterview")}</span>
    </div>
  );
}

export function Legend() {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-sm text-steel">
        {Object.entries(ARCHETYPE_STYLE).map(([id, s]) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-full ${s.bg}`} />
            {enumLabel("archetype", id)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
          {t("legend.awaitingDecision")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          {t("legend.aging")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-white">
            <AlertTriangle className="h-2 w-2" aria-hidden />
          </span>
          {t("legend.intakeDegraded")}
        </span>
      </div>
      <ScoreKindLegend />
    </div>
  );
}
