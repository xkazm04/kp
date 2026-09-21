"use client";

// The candidate modal's header: Back, the name (the dialog's accessible name), the
// archetype · job · stage chip · source line, the "JD edited" staleness chip, and
// the pager through the cohort. Carries over the drawer header's contracts: the
// stage is the shared chip toned by ROLE, provenance names campaign and variant, and
// a score computed before the JD's last edit says so where decisions are made.

import { ArrowLeft, ChevronLeft, ChevronRight, History } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusChip } from "@/app/_components/StatusChip";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { pipelineStageTone } from "@/app/_lib/status-tone";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/pipelineTypes";

type Pager = {
  index: number;
  total: number;
  prev: Entry | null;
  next: Entry | null;
  onNavigate: (entry: Entry) => void;
};

export function CandidateModalHeader({
  entry,
  titleId,
  stageText,
  axis,
  staleSince,
  pager,
  onBack,
}: {
  entry: Entry;
  titleId: string;
  stageText: string;
  axis: readonly StageDef[];
  staleSince: string | null;
  /** Null when there is no cohort to walk (a rematch counterpart, a lone candidate). */
  pager: Pager | null;
  onBack: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const tc = useTranslations("pipeline.candidate");
  const tChannels = useTranslations("analytics.channels");
  const enumLabel = useEnumLabel();
  const formatDate = useDateFormat();
  const staleOn = staleSince ? formatDate.date(staleSince) : "";
  const channelName = (channel: string) => {
    const key = `names.${channel}` as Parameters<typeof tChannels>[0];
    return tChannels.has(key) ? tChannels(key) : channel;
  };

  return (
    <header className="flex items-start gap-3 border-b border-stone-200 px-4 py-4 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        aria-label={tc("back")}
        title={tc("back")}
        className={`${BTN_GHOST} h-9 w-9 shrink-0 cursor-pointer justify-center`}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="break-words font-serif text-h2 leading-tight text-ink">
          {entry.candidateLabel}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-steel">
          <span>{enumLabel("archetype", entry.archetype)}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{entry.jobTitle}</span>
          <StatusChip tone={pipelineStageTone(entry.stage, axis)} label={stageText} />
          {entry.sourceChannel ? (
            <span>
              {t("via", { channel: channelName(entry.sourceChannel) })}
              {entry.sourceCampaign ? ` · ${entry.sourceCampaign}` : null}
              {entry.sourceVariant ? ` · ${entry.sourceVariant}` : null}
            </span>
          ) : null}
        </p>
        {staleSince ? (
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-800"
            title={t("jdEditedTitle", { date: staleOn })}
          >
            <History size={11} aria-hidden /> {t("jdEditedBadge", { date: staleOn })}
          </span>
        ) : null}
      </div>
      {pager ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => pager.prev && pager.onNavigate(pager.prev)}
            disabled={!pager.prev}
            aria-label={t("prevCandidate")}
            title={t("prevCandidate")}
            className={`${BTN_GHOST} h-8 w-8 cursor-pointer justify-center disabled:cursor-default disabled:opacity-30`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="nums min-w-[3.5rem] text-center text-sm text-steel" aria-live="polite">
            {t("cohortPosition", { index: pager.index + 1, total: pager.total })}
          </span>
          <button
            type="button"
            onClick={() => pager.next && pager.onNavigate(pager.next)}
            disabled={!pager.next}
            aria-label={t("nextCandidate")}
            title={t("nextCandidate")}
            className={`${BTN_GHOST} h-8 w-8 cursor-pointer justify-center disabled:cursor-default disabled:opacity-30`}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
