"use client";

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useMatchTabRun } from "./useMatchTabRun";

// Tier 3 (docs/design/loading-choreography.md): MatchResults.tsx (plus the MatchCard/
// MatchWeightsPanel/MatchJobCompare subtree it pulls in) is a heavy, purely
// post-action payload — it never renders on the tab's first frame, only once a
// match run has returned. Splitting it out of the tab's own chunk keeps tier-1
// entry light; the chunk-load gap is a quiet reserved box (never a skeleton),
// distinct from the "Matching…" action-progress text the run button/paragraph
// already show while the fetch itself is in flight.
const MatchResults = dynamic(() => import("./MatchResults").then((m) => ({ default: m.MatchResults })), {
  loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden />,
});

export function MatchTab() {
  const t = useTranslations("match.tab");
  const enumLabel = useEnumLabel();
  const {
    source, setSource,
    profiles, stale,
    analyses,
    optionsLoaded,
    selProfile, setSelProfile,
    selAnalysis, setSelAnalysis,
    result, matchRef,
    loading,
    filed, recordFiled,
    runMatchFor, runMatch,
    view,
  } = useMatchTabRun(t);

  return (
    // Tier 1: header + picker row + results region cascade in as this section's
    // direct children (stagger-children, globals.css). aria-busy covers only the
    // first options load (GET /api/profile + /api/analyses) — a later match run
    // or re-rank never blanks what is already on screen.
    <section className="stagger-children rounded-lg border border-stone-200 bg-white p-5 shadow-panel" aria-busy={!optionsLoaded}>
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">{t("source")}</span>
          <SegmentedControl
            label={t("source")}
            className="flex gap-1"
            value={source}
            onChange={setSource}
            options={[
              { value: "profile", label: t("savedProfile") },
              { value: "analysis", label: t("savedAnalysis") },
            ]}
          />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">{t("candidate")}</span>
          {source === "profile" ? (
            <Select
              ariaLabel={t("candidate")}
              value={selProfile}
              onChange={setSelProfile}
              disabled={!optionsLoaded}
              className="min-w-[280px]"
              options={
                !optionsLoaded
                  ? [{ value: "", label: t("loadingOptions") }]
                  : profiles.length === 0
                    ? [{ value: "", label: t("noProfiles") }]
                    : profiles.map((p) => ({
                        value: p.id,
                        label: t("profileOption", {
                          label: p.label,
                          archetype: enumLabel("archetype", p.archetype ?? ""),
                          completeness: Math.round((p.completeness ?? 0) * 100),
                        }),
                      }))
              }
            />
          ) : (
            <Select
              ariaLabel={t("candidate")}
              value={selAnalysis}
              onChange={setSelAnalysis}
              disabled={!optionsLoaded}
              className="min-w-[280px]"
              options={
                !optionsLoaded
                  ? [{ value: "", label: t("loadingOptions") }]
                  : analyses.length === 0
                    ? [{ value: "", label: t("noAnalyses") }]
                    : analyses.map((a) => ({
                        value: a.slug,
                        label: t("analysisOption", { label: a.candidate_label, family: a.role_family ?? "—", seniority: a.seniority ?? "—" }),
                      }))
              }
            />
          )}
        </label>

        <button
          type="button"
          onClick={runMatch}
          disabled={loading || (source === "profile" ? !selProfile : !selAnalysis)}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-base font-semibold text-white disabled:opacity-40"
        >
          {loading ? t("matching") : t("runMatching")}
        </button>
      </div>

      <div className="mt-5">
        {view.kind === "results" && result ? (
          // Tier 2: the ranking just arrived (or a candidate switch remounted this
          // subtree) — fade it in in place. A same-candidate re-rank keeps this
          // wrapper mounted (view.kind stays "results"), so the fade plays once on
          // arrival, never on every re-weight.
          <div className="animate-arrive-in">
            <MatchResults
              // Candidate-scoped remount (shortlist-to-group-eval premise fix): the
              // added/adding/selected sets inside MatchResults are keyed by jobId, so
              // without this a mark from candidate A ("already added to role X")
              // leaked onto candidate B and blocked filing a SECOND candidate into
              // the same role. Keying by the match ref resets that state per
              // candidate while re-weight runs of the same candidate keep it.
              key={matchRef.profileId ?? matchRef.analysisSlug ?? "run"}
              result={result}
              matchRef={matchRef}
              loading={loading}
              // A profile-sourced candidate carries its staleness so the ranking flags
              // "built from an older CV" and offers a rebuild. Null for analysis-sourced
              // runs and hand-built profiles (never stale).
              staleness={matchRef.profileId ? stale[matchRef.profileId] ?? null : null}
              // Keep the last good ranking on screen; a failed re-rank rides above it
              // as a non-destructive banner rather than replacing the whole panel.
              error={view.inlineError ? t("rerankFailed", { error: view.inlineError }) : null}
              onReweight={(w) => runMatchFor(matchRef, w)}
              filed={filed}
              onFiled={recordFiled}
            />
          </div>
        ) : view.kind === "error" ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{view.message}</p>
        ) : view.kind === "loading" ? (
          <p className="rounded-md bg-paper p-4 text-base text-steel">{t("matching")}</p>
        ) : (
          <ChainEmptyState
            title={t("emptyPrompt")}
            body={t("emptyChainBody")}
            links={[
              { tab: "profile", label: t("emptyCtaProfile") },
              { tab: "analyze", label: t("emptyCtaAnalyze") },
            ]}
          />
        )}
      </div>
    </section>
  );
}
