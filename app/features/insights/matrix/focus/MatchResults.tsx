"use client";

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import type { MatchRef, MatchResponse } from "@/app/features/shared/matchTypes";
import { isEarlyCareer } from "@/app/features/shared/matchTypes";
import { KoReasonsNote, NoMatchesExplainer } from "@/app/features/shared/MatchPresentation";
import { MatchCard } from "./MatchCard";
import { MatchWeightsPanel } from "./MatchWeightsPanel";
import { MatchResultsHeader } from "./MatchResultsHeader";
import { MatchResultsGroupEvalBanner } from "./MatchResultsGroupEvalBanner";
import { MatchResultsBulkToolbar } from "./MatchResultsBulkToolbar";
import { useMatchResultsPipeline } from "./useMatchResultsPipeline";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import type { WeightVector } from "@/app/features/shared/matchTypes";

// Below this many survivors the result reads as "thin", so we name the dominant KO
// blocker inline; a full corpus that simply hits the limit shouldn't trigger it.
const THIN_RESULT_MAX = 4;

// Tier 3 (docs/design/loading-choreography.md): the role-compare table only mounts once the
// recruiter ticks 2+ roles and hits "Compare" — most result views never open it — so
// it gets its own chunk instead of riding along with every match run. The gap is a
// quiet reserved box; the "Compare" toggle itself is the click that starts it, so
// there is no separate entry-loading state to protect here.
const MatchJobCompare = dynamic(() => import("./MatchJobCompare").then((m) => ({ default: m.MatchJobCompare })), {
  loading: () => <div className="reveal-quiet mt-4 min-h-[16rem]" aria-hidden />,
});

export function MatchResults({
  result,
  matchRef,
  loading = false,
  error = null,
  staleness = null,
  onReweight,
  filed,
  onFiled,
}: {
  result: MatchResponse;
  matchRef: MatchRef;
  // MAT1: re-run the match with a recruiter weight override (undefined = reset to
  // the archetype baseline). Omitted where re-weighting isn't wired.
  loading?: boolean;
  // A re-rank/re-weight that failed while this (still-valid) ranking is on screen:
  // shown as a non-destructive banner ABOVE the results, never replacing them.
  error?: string | null;
  // Profile ↔ CV staleness: set when this ranking is for a profile-sourced candidate
  // whose source CV has a NEWER analysis. Null for analysis-sourced runs and
  // hand-built profiles (never stale) ⇒ no badge, no chrome.
  staleness?: { newerSlug: string; newerAnalyzedAt: string } | null;
  onReweight?: (weights?: WeightVector) => void;
  // shortlist-to-group-eval — the cross-candidate session ledger (owned by
  // MatrixCandidateFocus; this component remounts per candidate) of pipeline entries filed
  // from Match, keyed by jobId. Roles with ≥ 2 entries surface the
  // "Compare N in group eval" handoff banner; onFiled records each successful,
  // decision-gated add's entry id. Both optional so Results renders unchanged
  // where the handoff isn't wired.
  filed?: Record<string, { jobTitle: string; entryIds: string[] }>;
  onFiled?: (jobId: string, jobTitle: string, entryId: string) => void;
}) {
  const t = useTranslations("match.results");
  const { candidate, meta, matches } = result;
  // The routing value we CARRY (posted to the pipeline, passed to MatchCard, fed to
  // isEarlyCareer): honour the matcher's fail-closed "unknown" sentinel instead of
  // fabricating "bau" — "bau" would strip the fairness shield off an unrouted
  // (student/switcher/unclassified) candidate downstream. The chip below shows this
  // honestly as "Unrouted", never "Experienced".
  const archetype = candidate.archetype ?? "unknown";
  const early = isEarlyCareer(archetype);

  const candidateId = matchRef.profileId ?? matchRef.analysisSlug ?? "";
  const {
    added, adding, errors,
    selected, setSelected,
    bulkBusy,
    comparing, setComparing,
    addableMatches,
    addToPipeline,
    toggleSelect,
    shortlistTop,
    addSelected,
  } = useMatchResultsPipeline({ t, candidateId, candidate, archetype, matches, onFiled });

  // Export the ranking as CSV (Theme C) — a hiring decision happens in a meeting
  // or email thread outside the app, so the ranking has to be able to leave it.
  // Built entirely from data already on screen; no backend call.
  const exportCsv = () => {
    const header = [t("csv.rank"), t("csv.role"), t("csv.company"), t("csv.score"), t("csv.confLow"), t("csv.confHigh"), t("csv.fitTier"), t("csv.matchedSkills"), t("csv.missingSkills")];
    const rows = matches.map((m, i) => [
      i + 1,
      m.title,
      m.company ?? "",
      m.total,
      m.confidence.low,
      m.confidence.high,
      m.fitTier,
      (m.matchedSkills ?? []).join("; "),
      (m.missingSkills ?? []).join("; "),
    ]);
    const safe = (candidate.label ?? "candidate").replace(/[^\w-]+/g, "_").slice(0, 60) || "candidate";
    downloadFile(`matches-${safe}.csv`, toCsv([header, ...rows]), "text/csv");
  };

  return (
    <div>
      <MatchResultsHeader
        matchRef={matchRef}
        error={error}
        staleness={staleness}
        candidate={candidate}
        meta={meta}
        matchesLength={matches.length}
        archetype={archetype}
        early={early}
        onExportCsv={exportCsv}
      />

      {onReweight && candidate.weights && candidate.weightBounds ? (
        <MatchWeightsPanel
          weights={candidate.weights}
          bounds={candidate.weightBounds}
          archetype={archetype}
          busy={loading}
          onApply={(w) => onReweight(w)}
          onReset={() => onReweight(undefined)}
        />
      ) : null}

      <MatchResultsGroupEvalBanner filed={filed} />

      {matches.length === 0 ? (
        <div className="mt-4">
          <NoMatchesExplainer meta={meta} archetype={archetype} />
        </div>
      ) : (
        <>
          {matches.length <= THIN_RESULT_MAX ? (
            <KoReasonsNote koFiltered={meta.koFiltered ?? 0} reasons={meta.koReasons ?? []} />
          ) : null}
          {candidateId && addableMatches.length > 1 ? (
            <MatchResultsBulkToolbar
              selectedCount={selected.size}
              addableCount={addableMatches.length}
              bulkBusy={bulkBusy}
              comparing={comparing}
              onAddSelected={addSelected}
              onShortlistTop={shortlistTop}
              onToggleComparing={() => setComparing((v) => !v)}
              onClearSelected={() => setSelected(new Set())}
            />
          ) : null}
          {comparing && selected.size >= 2 ? (
            <MatchJobCompare matches={matches.filter((m) => selected.has(m.jobId))} onClose={() => setComparing(false)} />
          ) : null}
          <ol className="mt-4 space-y-2">
            {matches.map((m, i) => (
              <MatchCard
                key={m.jobId}
                m={m}
                index={i}
                matchRef={matchRef}
                archetype={archetype}
                canAdd={Boolean(candidateId)}
                added={added.has(m.jobId)}
                adding={adding.has(m.jobId)}
                addError={errors.get(m.jobId)}
                onAdd={() => addToPipeline(m)}
                selectable={Boolean(candidateId)}
                selected={selected.has(m.jobId)}
                onToggleSelect={() => toggleSelect(m.jobId)}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
