"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AnalysisRow, MatchRef, MatchResponse, ProfileRow, WeightVector } from "./MatchTypes";
import { Results } from "./Results";
import { selectMatchView } from "./match-view";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

export function MatchTab() {
  const t = useTranslations("match.tab");
  const enumLabel = useEnumLabel();
  const [source, setSource] = useState<"profile" | "analysis">("profile");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [selProfile, setSelProfile] = useState("");
  const [selAnalysis, setSelAnalysis] = useState("");

  const [result, setResult] = useState<MatchResponse | null>(null);
  const [matchRef, setMatchRef] = useState<MatchRef>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useSearchParams();
  const profileParam = search.get("profile");
  const analysisParam = search.get("analysis");
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    let alive = true;
    // Track when BOTH option fetches have settled so the candidate <select> can show a
    // loading placeholder instead of "No saved profiles/analyses" (which conflated the
    // in-flight fetch with a genuinely empty account).
    Promise.allSettled([
      fetch("/api/profile")
        .then((r) => r.json())
        .then((p) => {
          if (!alive) return;
          const rows = (p.profiles as ProfileRow[]) ?? [];
          setProfiles(rows);
          if (rows.length) setSelProfile(rows[0].id);
          else setSource("analysis");
        }),
      fetch("/api/analyses")
        .then((r) => r.json())
        .then((p) => {
          if (!alive) return;
          const rows = (p.analyses as AnalysisRow[]) ?? [];
          setAnalyses(rows);
          if (rows.length) setSelAnalysis(rows[0].slug);
        }),
    ]).finally(() => {
      if (alive) setOptionsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // `weights` (MAT1) is the recruiter's optional override for a re-rank; omitted on
  // a fresh run (server uses the archetype baseline) and on a reset.
  const runMatchFor = async (ref: MatchRef, weights?: WeightVector) => {
    if (!ref.profileId && !ref.analysisSlug) return;
    setLoading(true);
    setError(null);
    // Don't clear the prior result on a re-rank/re-weight: clearing unmounts <Results> (and
    // the WeightsPanel the user is dragging) to the empty placeholder until the fetch returns.
    // Keeping it mounted lets <Results loading> show its in-place busy state; a fresh run with
    // no prior result falls to the loading branch in the gate below.
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ref, limit: 25, ...(weights ? { weights } : {}) }),
      });
      const payload = await r.json();
      // An unknown deep-linked id resolves to 404 (Profile/Analysis not found) —
      // surface an honest, localized message rather than leaking the raw server
      // string or letting a doomed auto-run fail silently.
      if (r.status === 404) throw new Error(t("candidateNotFound"));
      if (!r.ok) throw new Error(payload.error ?? t("matchFailedStatus", { status: r.status }));
      setResult(payload as MatchResponse);
      setMatchRef(ref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("matchFailed"));
    } finally {
      setLoading(false);
    }
  };

  const runMatch = () =>
    runMatchFor(source === "profile" ? { profileId: selProfile } : { analysisSlug: selAnalysis });

  // Deep link into Match: ?tab=match&profile=<id> OR ?tab=match&analysis=<slug>
  // — preselect the matching source and auto-run once. Analysis deep-links are
  // supported symmetrically with profiles so a persisted CV analysis lands in
  // Match exactly like a saved profile does. Deferred kick-off (0 ms timer): the
  // preselect setters and runMatchFor's loading flag would otherwise fire
  // synchronously in the effect body and cascade a render before the first
  // commit settles. An unknown id surfaces the honest 404 message from runMatchFor.
  useEffect(() => {
    if (autoRan) return;
    const ref: MatchRef | null = profileParam
      ? { profileId: profileParam }
      : analysisParam
        ? { analysisSlug: analysisParam }
        : null;
    if (!ref) return;
    const timer = window.setTimeout(() => {
      setAutoRan(true);
      if (ref.profileId) {
        setSource("profile");
        setSelProfile(ref.profileId);
      } else {
        setSource("analysis");
        setSelAnalysis(ref.analysisSlug ?? "");
      }
      void runMatchFor(ref);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profileParam, analysisParam, autoRan]);

  // A prior ranking always wins over a transient error: selectMatchView keeps
  // <Results> mounted on a failed re-rank and demotes the error to a
  // non-destructive inline banner (job-ui #2). The full-panel error branch is
  // reserved for when there is no ranking to protect.
  const view = selectMatchView({ hasResult: result !== null, error, loading });

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
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
          <Results
            result={result}
            matchRef={matchRef}
            loading={loading}
            // Keep the last good ranking on screen; a failed re-rank rides above it
            // as a non-destructive banner rather than replacing the whole panel.
            error={view.inlineError ? t("rerankFailed", { error: view.inlineError }) : null}
            onReweight={(w) => runMatchFor(matchRef, w)}
          />
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
