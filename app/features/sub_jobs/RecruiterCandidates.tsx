"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { ARCHETYPE_BADGE, isEarlyCareer, provLabel } from "./JobsTypes";
import type { CandRow, SkippedCandidate } from "./JobsTypes";
import { EmptyState, SkippedCandidatesNote } from "./JobsShared";
import { ConfidenceBandBadge, confidenceBandTitle, FitTierBadge } from "@/app/_components/Badge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";

export function RecruiterCandidates({
  jobId,
  jobTitle,
  roleFamily,
  autoLoad = false,
}: {
  jobId: string;
  jobTitle: string;
  roleFamily: string | null;
  autoLoad?: boolean;
}) {
  const [data, setData] = useState<{
    candidates: CandRow[];
    skipped?: SkippedCandidate[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [announce, setAnnounce] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/candidates`);
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `Failed (${r.status}).`);
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoad && !data && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const addToPipeline = async (c: CandRow) => {
    if (!c.candidateId || added.has(c.candidateId) || adding.has(c.candidateId)) return;
    setAdding((s) => new Set(s).add(c.candidateId));
    setFailed((m) => {
      if (!m.has(c.candidateId)) return m;
      const n = new Map(m);
      n.delete(c.candidateId);
      return n;
    });
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: c.candidateId,
          candidateLabel: c.label,
          archetype: c.archetype,
          roleFamily,
          jobId,
          jobTitle,
          matchScore: c.result.total,
          stage: "Screened",
        }),
      });
      const payload = await r.json().catch(() => null);
      if (!r.ok) throw new Error(payload?.error ?? `Couldn't add (${r.status}).`);
      setAdded((s) => new Set(s).add(c.candidateId));
      setAnnounce(`${c.label} added to the pipeline.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Couldn't add to the pipeline.";
      setFailed((m) => new Map(m).set(c.candidateId, message));
      setAnnounce(`Couldn't add ${c.label} to the pipeline. ${message}`);
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(c.candidateId);
        return n;
      });
    }
  };

  if (!data) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 p-3">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="focus-ring rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? "Scoring candidates…" : "Score saved candidates against this role"}
        </button>
        {error ? <span className="ml-2 text-sm text-red-700">{error}</span> : null}
      </div>
    );
  }

  const eligible = data.candidates.filter((c) => c.koPassed);
  const earlyCareer = eligible.filter((c) => isEarlyCareer(c.archetype));
  const experienced = eligible.filter((c) => !isEarlyCareer(c.archetype));
  const notEligible = data.candidates.length - eligible.length;
  const skipped = data.skipped ?? [];

  return (
    <div className="rounded-md border border-stone-200 p-3">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-coral">
          Candidates · fair-comparison lens
        </p>
        <span className="text-sm text-steel">{notEligible} not eligible (KO-filtered)</span>
      </div>
      <p className="mt-1 text-sm text-steel">
        Early-career candidates are shown as a separate pipeline and scored on potential — never ranked on one number
        against experienced candidates.
      </p>
      <SkippedCandidatesNote skipped={skipped} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <CandidateColumn
          title="Experienced"
          rows={experienced}
          added={added}
          adding={adding}
          failed={failed}
          onAdd={addToPipeline}
        />
        <CandidateColumn
          title="Early-career pipeline"
          rows={earlyCareer}
          highlight
          added={added}
          adding={adding}
          failed={failed}
          onAdd={addToPipeline}
        />
      </div>
    </div>
  );
}

function CandidateColumn({
  title,
  rows,
  highlight,
  added,
  adding,
  failed,
  onAdd,
}: {
  title: string;
  rows: CandRow[];
  highlight?: boolean;
  added: Set<string>;
  adding: Set<string>;
  failed: Map<string, string>;
  onAdd: (c: CandRow) => void;
}) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-green-200 bg-green-50/40" : "border-stone-200"}`}>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No candidates in this group" compact />
      ) : (
        <ol className="mt-2 space-y-2">
          {rows.map((c, i) => (
            <CandidateCard
              key={c.candidateId || `${c.label}-${i}`}
              c={c}
              added={added.has(c.candidateId)}
              adding={adding.has(c.candidateId)}
              error={failed.get(c.candidateId) ?? null}
              onAdd={() => onAdd(c)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function CandidateCard({
  c,
  added,
  adding,
  error,
  onAdd,
}: {
  c: CandRow;
  added: boolean;
  adding: boolean;
  error: string | null;
  onAdd: () => void;
}) {
  const res = c.result;
  const early = isEarlyCareer(c.archetype);
  const prov = res.matchedSkillProvenance ?? {};
  return (
    <li className="rounded-md border border-stone-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <ScoreBadge score={res.total} />
        <span className="nums text-sm text-steel" title={confidenceBandTitle(res.confidence.drivers)}>
          {res.confidence.low}–{res.confidence.high}
        </span>
        <ConfidenceBandBadge level={res.confidence.level} drivers={res.confidence.drivers} />
        <span className="font-medium text-ink">{c.label}</span>
        <span className="rounded-full bg-ink/90 px-1.5 py-0.5 text-sm font-semibold text-white">
          {ARCHETYPE_BADGE[c.archetype] ?? c.archetype}
        </span>
        <FitTierBadge tier={res.fitTier} score={res.total} />
        <span className="ml-auto flex items-center gap-2">
          {early && c.potentialScore != null ? (
            <span className="text-sm text-steel">potential {Math.round(c.potentialScore * 100)}</span>
          ) : null}
          <button
            type="button"
            onClick={onAdd}
            disabled={added || adding}
            title={error ?? undefined}
            className={`focus-ring rounded px-1.5 py-0.5 text-sm font-semibold ${
              added
                ? "bg-moss/10 text-moss"
                : error
                  ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                  : "border border-stone-200 text-ink hover:bg-paper disabled:opacity-40"
            }`}
          >
            {added ? "✓ pipeline" : adding ? "…" : error ? "↻ retry" : "+ pipeline"}
          </button>
        </span>
      </div>
      {error && !added ? (
        <p className="mt-1 text-sm text-red-700">Couldn&apos;t add to the pipeline — {error}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-1">
        {(res.matchedSkills ?? []).slice(0, 8).map((s) => {
          const pl = provLabel(prov[s] ?? "self_declared");
          return (
            <span key={s} className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700">
              {s}
              <span className={`rounded px-1 text-sm uppercase ${pl.tone}`}>{pl.text}</span>
            </span>
          );
        })}
        {(res.missingSkills ?? []).slice(0, 4).map((s) => (
          <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">
            ✗ {s}
          </span>
        ))}
      </div>
      {c.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">Assumptions:</span> {c.assumptions[0]}
        </p>
      ) : null}
    </li>
  );
}
