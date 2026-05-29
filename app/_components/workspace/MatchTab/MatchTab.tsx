"use client";

import { useEffect, useState } from "react";

type AnalysisRow = {
  slug: string;
  candidate_label: string;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
};

type MatchResult = {
  jobId: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  roleFamily?: string;
  salaryBand?: number[];
  total: number;
  skillsScore: number;
  careerScore: number;
  personalScore: number;
  confidenceLow: number;
  confidenceHigh: number;
  matchedSkills?: string[];
  missingSkills?: string[];
  isEntryEligible?: boolean;
  graduateFriendliness?: number;
};

type MatchResponse = {
  candidate: { label?: string; seniority?: string; roleFamily?: string; archetype?: string; skills?: number };
  meta: { evaluated?: number; koFiltered?: number; survivors?: number; returned?: number };
  matches: MatchResult[];
};

const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};

export function MatchTab() {
  const [analyses, setAnalyses] = useState<AnalysisRow[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analyses")
      .then((r) => r.json())
      .then((payload) => {
        const rows = (payload.analyses as AnalysisRow[]) ?? [];
        setAnalyses(rows);
        if (rows.length && !selected) setSelected(rows[0].slug);
      })
      .catch(() => setAnalyses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runMatch = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisSlug: selected, limit: 25 }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Match failed (${r.status}).`);
      setResult(payload as MatchResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Match failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Match candidate → jobs</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Run a saved candidate against the whole job corpus. Three layers: hard <strong>KO filters</strong>{" "}
          (seniority floor, education, languages) narrow the corpus, then a <strong>multi-factor scorer</strong>{" "}
          (skills via the taxonomy hierarchy, career fit, personal fit) ranks the survivors with a confidence band.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">Candidate (saved analysis)</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="focus-ring h-10 min-w-[260px] rounded-md border border-stone-200 bg-white px-2 text-sm text-ink"
          >
            {analyses == null ? (
              <option>Loading…</option>
            ) : analyses.length === 0 ? (
              <option value="">No saved analyses — run one in Analyze first</option>
            ) : (
              analyses.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.candidate_label} · {a.role_family ?? "—"} / {a.seniority ?? "—"}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          onClick={runMatch}
          disabled={!selected || loading}
          className="focus-ring h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? "Matching…" : "Run matching"}
        </button>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : result ? (
          <Results result={result} />
        ) : (
          <p className="rounded-md bg-paper p-4 text-sm text-steel">
            Pick a candidate and run matching to see ranked, KO-filtered, scored jobs.
          </p>
        )}
      </div>
    </section>
  );
}

function Results({ result }: { result: MatchResponse }) {
  const { candidate, meta, matches } = result;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Candidate" value={candidate.label ?? "—"} />
        <Chip label="Profile" value={`${candidate.roleFamily ?? "—"} / ${candidate.seniority ?? "—"}`} />
        <Chip label="Evaluated" value={meta.evaluated ?? 0} />
        <Chip label="KO-filtered" value={meta.koFiltered ?? 0} tone="amber" />
        <Chip label="Ranked" value={meta.returned ?? matches.length} tone="green" />
      </div>

      <ol className="mt-4 space-y-2">
        {matches.map((m, i) => (
          <li key={m.jobId} className="rounded-lg border border-stone-200 p-3">
            <div className="flex items-start gap-4">
              <div className="w-16 shrink-0 text-center">
                <div className="font-serif text-2xl text-ink">{m.total}</div>
                <div className="text-[10px] text-steel">
                  {m.confidenceLow}–{m.confidenceHigh}
                </div>
                <div className="mt-0.5 text-[10px] uppercase text-steel">#{i + 1}</div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{m.title}</span>
                  {m.isEntryEligible ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      entry-eligible
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-steel">
                  {m.company ?? "—"} · {m.location ?? "—"} · {m.workMode ?? "—"} ·{" "}
                  {FAMILY_LABEL[m.roleFamily ?? ""] ?? m.roleFamily} / {m.seniority} ·{" "}
                  {m.salaryBand && m.salaryBand.length === 2
                    ? `${Math.round(m.salaryBand[0] / 1000)}–${Math.round(m.salaryBand[1] / 1000)}k CZK`
                    : "—"}
                </p>

                <div className="mt-2 grid max-w-md grid-cols-3 gap-2">
                  <Bar label="Skills" value={m.skillsScore} />
                  <Bar label="Career" value={m.careerScore} />
                  <Bar label="Personal" value={m.personalScore} />
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {(m.matchedSkills ?? []).slice(0, 8).map((s) => (
                    <span
                      key={`m-${s}`}
                      className="rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700"
                    >
                      {s}
                    </span>
                  ))}
                  {(m.missingSkills ?? []).slice(0, 6).map((s) => (
                    <span
                      key={`x-${s}`}
                      className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700"
                      title="Missing must-have"
                    >
                      ✗ {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="flex justify-between text-[10px] text-steel">
        <span className="uppercase">{label}</span>
        <span>{pct}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-stone-100">
        <div className="h-1.5 rounded-full bg-coral" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-paper text-ink";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${toneClass}`}>
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
