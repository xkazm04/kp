"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AnalysisRow, MatchRef, MatchResponse, ProfileRow, WeightVector } from "./MatchTypes";
import { Results } from "./Results";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

export function MatchTab() {
  const t = useTranslations("match.tab");
  const enumLabel = useEnumLabel();
  const [source, setSource] = useState<"profile" | "analysis">("profile");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [selProfile, setSelProfile] = useState("");
  const [selAnalysis, setSelAnalysis] = useState("");

  const [result, setResult] = useState<MatchResponse | null>(null);
  const [matchRef, setMatchRef] = useState<MatchRef>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useSearchParams();
  const profileParam = search.get("profile");
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        const rows = (p.profiles as ProfileRow[]) ?? [];
        setProfiles(rows);
        if (rows.length) setSelProfile(rows[0].id);
        else setSource("analysis");
      })
      .catch(() => undefined);
    fetch("/api/analyses")
      .then((r) => r.json())
      .then((p) => {
        const rows = (p.analyses as AnalysisRow[]) ?? [];
        setAnalyses(rows);
        if (rows.length) setSelAnalysis(rows[0].slug);
      })
      .catch(() => undefined);
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

  // Deep link from the Pipeline (?tab=match&profile=<id>): preselect + auto-run
  // once. Deferred kick-off (0 ms timer): the preselect setters and runMatchFor's
  // loading flag would otherwise fire synchronously in the effect body and
  // cascade a render before the first commit settles.
  useEffect(() => {
    if (!profileParam || autoRan) return;
    const timer = window.setTimeout(() => {
      setSource("profile");
      setSelProfile(profileParam);
      setAutoRan(true);
      void runMatchFor({ profileId: profileParam });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profileParam, autoRan]);

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
            <select
              value={selProfile}
              onChange={(e) => setSelProfile(e.target.value)}
              className="focus-ring h-10 min-w-[280px] rounded-md border border-stone-200 bg-white px-2 text-base text-ink"
            >
              {profiles.length === 0 ? (
                <option value="">{t("noProfiles")}</option>
              ) : (
                profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("profileOption", {
                      label: p.label,
                      archetype: enumLabel("archetype", p.archetype ?? ""),
                      completeness: Math.round((p.completeness ?? 0) * 100),
                    })}
                  </option>
                ))
              )}
            </select>
          ) : (
            <select
              value={selAnalysis}
              onChange={(e) => setSelAnalysis(e.target.value)}
              className="focus-ring h-10 min-w-[280px] rounded-md border border-stone-200 bg-white px-2 text-base text-ink"
            >
              {analyses.length === 0 ? (
                <option value="">{t("noAnalyses")}</option>
              ) : (
                analyses.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {t("analysisOption", { label: a.candidate_label, family: a.role_family ?? "—", seniority: a.seniority ?? "—" })}
                  </option>
                ))
              )}
            </select>
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
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : result ? (
          <Results
            result={result}
            matchRef={matchRef}
            loading={loading}
            onReweight={(w) => runMatchFor(matchRef, w)}
          />
        ) : loading ? (
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
