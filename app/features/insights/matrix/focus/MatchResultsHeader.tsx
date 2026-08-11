"use client";

// Error/staleness banners + the candidate chip row + early-career note, split out
// of MatchResults.tsx.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, RefreshCw } from "lucide-react";
import type { MatchRef, MatchResponse } from "@/app/features/shared/matchTypes";
import { archetypeDisplayKey } from "@/app/features/shared/matchTypes";
import { Chip, useMatchLabels } from "@/app/features/shared/MatchPresentation";
import { buildUrl } from "@/app/features/shell/tabs";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

export function MatchResultsHeader({
  matchRef,
  error,
  staleness,
  candidate,
  meta,
  matchesLength,
  archetype,
  early,
  onExportCsv,
}: {
  matchRef: MatchRef;
  error: string | null;
  staleness: { newerSlug: string; newerAnalyzedAt: string } | null;
  candidate: MatchResponse["candidate"];
  meta: MatchResponse["meta"];
  matchesLength: number;
  archetype: string;
  early: boolean;
  onExportCsv: () => void;
}) {
  const t = useTranslations("match.results");
  const { assumptions: assumptionLabels } = useMatchLabels();
  const enumLabel = useEnumLabel();
  const router = useRouter();

  return (
    <>
      {/* Non-destructive re-rank error: the results below are the last good ranking. */}
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {staleness && matchRef.profileId ? (
        // Profile ↔ CV staleness: this ranking is off a profile built from an older
        // CV than a newer analysis on file. Neutral (amber) banner + one-click
        // rebuild-from-latest so the recruiter isn't ranking on a stale snapshot.
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <RefreshCw size={14} aria-hidden />
          <span className="font-semibold">{t("staleBanner")}</span>
          <span className="text-amber-700">
            {t("staleBannerDetail", { date: new Date(staleness.newerAnalyzedAt).toLocaleDateString() })}
          </span>
          <button
            type="button"
            onClick={() =>
              router.push(buildUrl({ tab: "profile", fromAnalysis: staleness.newerSlug, rebuild: matchRef.profileId! }, ""))
            }
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw size={13} /> {t("staleRebuild")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={t("chipCandidate")} value={candidate.label ?? "—"} />
        <Chip label={t("chipArchetype")} value={enumLabel("archetype", archetypeDisplayKey(archetype))} tone={early ? "green" : "neutral"} />
        <Chip label={t("chipProfile")} value={`${candidate.roleFamily ? enumLabel("family", candidate.roleFamily) : "—"} / ${candidate.seniority ?? "—"}`} />
        <Chip label={t("chipEvaluated")} value={meta.evaluated ?? 0} />
        <Chip label={t("chipKoFiltered")} value={meta.koFiltered ?? 0} tone="amber" />
        <Chip label={t("chipRanked")} value={meta.returned ?? matchesLength} tone="green" />
        {early && candidate.potentialScore != null ? (
          <PotentialBadge
            potential={{
              score: candidate.potentialScore,
              learningSignals: candidate.learningSignals,
              transferableSkills: candidate.transferableSkills,
              domainDistance: candidate.domainDistance,
            }}
          />
        ) : null}
        {matchesLength > 0 ? (
          <button
            type="button"
            onClick={onExportCsv}
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-ink hover:bg-paper"
          >
            <Download size={14} className="text-steel" /> {t("exportCsv")}
          </button>
        ) : null}
      </div>
      {early ? (
        <p className="mt-2 text-sm text-steel">
          {t.rich("earlyNote", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      ) : null}
      {candidate.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">{t("assumptions")}</span>{" "}
          {assumptionLabels(candidate.assumptionCodes, candidate.assumptions).join(" · ")}
        </p>
      ) : null}
    </>
  );
}
