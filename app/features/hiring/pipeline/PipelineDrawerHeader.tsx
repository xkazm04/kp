"use client";

// The candidate drawer's sticky header: monogram, name/archetype/stage/source
// line, the staleness chip, the canonical match score, and the cohort prev/next
// nav. Split out of PipelineCandidateDrawer.tsx.

import { ChevronLeft, ChevronRight, History, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { displayScoreOf } from "@/app/_lib/match-score";
import { initials } from "@/app/_lib/initials";
import { styleFor } from "@/app/features/shared/pipelineTypes";
// The drawer's narrow Pick of the board record — the header only ever renders the
// identity fields, and typing it wider than its caller would reject the drawer's
// own `entry` prop.
import type { Entry } from "./PipelineCandidateDrawerTypes";

export function PipelineDrawerHeader({
  entry,
  staleSince,
  cohortIndex,
  cohortLength,
  prevEntry,
  nextEntry,
  showCohortNav,
  onNavigatePrev,
  onNavigateNext,
  onClose,
}: {
  entry: Entry;
  staleSince: string | null;
  cohortIndex: number;
  cohortLength: number;
  prevEntry: Entry | null;
  nextEntry: Entry | null;
  showCohortNav: boolean;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  // d95fed6d — origin-chip labels reuse the channel-name catalog Analytics
  // already maintains, falling back to the raw id for unmapped values.
  const tChannels = useTranslations("analytics.channels");
  const channelName = (channel: string) => {
    const key = `names.${channel}` as Parameters<typeof tChannels>[0];
    return tChannels.has(key) ? tChannels(key) : channel;
  };
  const enumLabel = useEnumLabel();
  const locale = useLocale();
  const provenanceText = useScoreProvenanceText();
  const display = displayScoreOf(entry);
  const a = styleFor(entry.archetype);
  const monogram = initials(entry.candidateLabel);

  return (
    <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-stone-200 bg-paper/95 p-4 backdrop-blur">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold text-white ${a.bg}`}>{monogram}</span>
      <div className="min-w-0 flex-1">
        <p id="drawer-title" className="truncate font-serif text-lg text-ink">{entry.candidateLabel}</p>
        <p className="truncate text-sm text-steel">
          {enumLabel("archetype", entry.archetype)} · {entry.jobTitle} · <span className="text-ink">{enumLabel("stage", entry.stage)}</span>
          {/* d95fed6d — provenance: which surface/channel filed this person.
              variant-reaches-the-drawer — append the campaign then the creative
              variant when the entry carries them, so campaign attribution ("via
              Boards · summer-2026 · variant-b") is visible where advance/reject
              fires. Both absent ⇒ the line reads exactly as before ("via {channel}").
              Gated on sourceChannel: a variant never renders without its channel. */}
          {entry.sourceChannel ? (
            <>
              {" · "}
              {t("via", { channel: channelName(entry.sourceChannel) })}
              {entry.sourceCampaign ? <> · {entry.sourceCampaign}</> : null}
              {entry.sourceVariant ? <> · {entry.sourceVariant}</> : null}
            </>
          ) : null}
        </p>
        {/* drawer-staleness-parity — the SAME amber "JD edited {date}" History chip
            Decisions shows, so this surface (where advance/reject fires) can no
            longer read a stale score as fresh. Server-derived (isScoreStale);
            informs, never blocks. Absent for fresh/unscored/snapshot/corpus. */}
        {staleSince ? (
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-800"
            title={t("jdEditedTitle", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(staleSince)) })}
          >
            <History size={11} aria-hidden /> {t("jdEditedBadge", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(staleSince)) })}
          </span>
        ) : null}
      </div>
      {/* Canonical match score (REC-01 / OO-L2-10): the SAME number the board
          and the decisions queue show, with its provenance named — so this
          header can no longer contradict the "CV analysis saved — score N"
          item in the timeline below without saying why. */}
      {/* ONE THREAD (gap 2): the caption under the number is the SCORE KIND, so a
          work-sample transfer score — which this header used to print under the
          word "match", because promote had written it into match_score — names
          itself. displayScoreOf prefers the match score; the transfer score only
          fills the slot for a candidate no match run has scored yet. */}
      {display ? (
        <span className="rounded-md bg-white px-2 py-1 text-center" title={provenanceText(display.provenance) ?? undefined}>
          <span className="block font-serif text-lg leading-none text-ink">{display.score}</span>
          <span className="block text-sm uppercase text-steel">{display.kind === "transfer" ? t("transfer") : t("match")}</span>
          <span className="block max-w-[7rem] text-meta normal-case leading-tight text-steel">
            {provenanceText(display.provenance)}
          </span>
        </span>
      ) : null}
      {/* drawer-flow-friction — walk the filtered cohort without closing the
          drawer between candidates: a stub-by-stub path through a needs-intake
          wave (or any filtered lane) instead of one-and-done. */}
      {showCohortNav ? (
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onNavigatePrev}
              disabled={!prevEntry}
              aria-label={t("prevCandidate")}
              title={t("prevCandidate")}
              className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100 disabled:opacity-30"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onNavigateNext}
              disabled={!nextEntry}
              aria-label={t("nextCandidate")}
              title={t("nextCandidate")}
              className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100 disabled:opacity-30"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
          <span className="text-meta text-steel nums" aria-live="polite">
            {t("cohortPosition", { index: cohortIndex + 1, total: cohortLength })}
          </span>
        </div>
      ) : null}
      <button type="button" onClick={onClose} className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100">
        <X size={18} />
      </button>
    </header>
  );
}
