"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AnalysisRow, MatchRef, MatchResponse, ProfileRow } from "./MatchTypes";
import { ARCHETYPE_LABEL } from "./MatchTypes";
import { Results } from "./Results";

export function MatchTab() {
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

  const runMatchFor = async (ref: MatchRef) => {
    if (!ref.profileId && !ref.analysisSlug) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ref, limit: 25 }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Match failed (${r.status}).`);
      setResult(payload as MatchResponse);
      setMatchRef(ref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Match failed.");
    } finally {
      setLoading(false);
    }
  };

  const runMatch = () =>
    runMatchFor(source === "profile" ? { profileId: selProfile } : { analysisSlug: selAnalysis });

  // Deep link from the Pipeline (?tab=match&profile=<id>): preselect + auto-run once.
  useEffect(() => {
    if (profileParam && !autoRan) {
      setSource("profile");
      setSelProfile(profileParam);
      setAutoRan(true);
      void runMatchFor({ profileId: profileParam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileParam, autoRan]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Match candidate → jobs</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Run a candidate against the whole corpus. KO filters narrow it, a multi-factor scorer ranks the survivors,
          and the per-match reasoning explains the fit. Student / career-switcher profiles are scored on a different
          profile — <strong>potential replaces years of experience</strong>, skills are provenance-discounted, and
          the KO filter keeps only entry-eligible roles.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">Source</span>
          <div className="flex gap-1">
            {(["profile", "analysis"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-md border px-3 py-1.5 text-base ${
                  source === s ? "border-ink bg-ink text-white" : "border-stone-200 text-ink hover:bg-paper"
                }`}
              >
                {s === "profile" ? "Saved profile" : "Saved analysis"}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-wide text-steel">Candidate</span>
          {source === "profile" ? (
            <select
              value={selProfile}
              onChange={(e) => setSelProfile(e.target.value)}
              className="focus-ring h-10 min-w-[280px] rounded-md border border-stone-200 bg-white px-2 text-base text-ink"
            >
              {profiles.length === 0 ? (
                <option value="">No saved profiles — build one in Profile</option>
              ) : (
                profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {ARCHETYPE_LABEL[p.archetype ?? ""] ?? p.archetype} ·{" "}
                    {Math.round((p.completeness ?? 0) * 100)}%
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
                <option value="">No saved analyses — run one in Analyze</option>
              ) : (
                analyses.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.candidate_label} · {a.role_family ?? "—"} / {a.seniority ?? "—"}
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
          {loading ? "Matching…" : "Run matching"}
        </button>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : result ? (
          <Results result={result} matchRef={matchRef} />
        ) : (
          <p className="rounded-md bg-paper p-4 text-base text-steel">
            Pick a candidate and run matching to see ranked, KO-filtered, scored jobs.
          </p>
        )}
      </div>
    </section>
  );
}
