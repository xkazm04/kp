"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { ARCHETYPE_BADGE, isEarlyCareer, provLabel } from "./JobsTypes";
import type { CandRow, SkippedCandidate } from "./JobsTypes";
import { EmptyState, SkippedCandidatesNote } from "./JobsShared";
import { useAddToPipeline } from "@/app/_lib/useAddToPipeline";
import { useReachOut } from "@/app/_lib/useReachOut";
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
  const { add, added, adding, error: cardError, announce } = useAddToPipeline(jobId, jobTitle);
  const { reach, reached, reaching, error: reachError, announce: reachAnnounce } = useReachOut(jobId);

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

  // Deferred kick-off (0 ms timer): load() flips the loading flag synchronously,
  // and a sync setState in the effect body would cascade a render before the
  // first commit settles. The guard runs inside the tick with the values it
  // captured at effect time — the same read the original synchronous check made.
  useEffect(() => {
    if (!autoLoad) return;
    const t = window.setTimeout(() => {
      if (!data && !loading) load();
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const candidateInput = (c: CandRow) => ({
    candidateId: c.candidateId,
    candidateLabel: c.label,
    archetype: c.archetype,
    matchScore: c.result.total,
    roleFamily,
  });
  const addToPipeline = (c: CandRow) => add(candidateInput(c));
  const reachOut = (c: CandRow) => reach(candidateInput(c));

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
        {[announce, reachAnnounce].filter(Boolean).join(" ")}
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
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
        />
        <CandidateColumn
          title="Early-career pipeline"
          rows={earlyCareer}
          highlight
          added={added}
          adding={adding}
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
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
  error,
  onAdd,
  reached,
  reaching,
  reachError,
  onReach,
}: {
  title: string;
  rows: CandRow[];
  highlight?: boolean;
  added: (id: string) => boolean;
  adding: (id: string) => boolean;
  error: (id: string) => string | null;
  onAdd: (c: CandRow) => void;
  reached: (id: string) => boolean;
  reaching: (id: string) => boolean;
  reachError: (id: string) => string | null;
  onReach: (c: CandRow) => void;
}) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-green-200 bg-green-50/40" : "border-stone-200"}`}>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">
        {title} ({rows.length})
      </p>
      {highlight ? (
        // The fairness guarantee, stated where the candidates actually are — not
        // only in the policy modal: this cohort is scored on potential and is
        // structurally shielded from automated rejection.
        <p className="mt-0.5 text-sm text-steel">
          Fairness-shielded: scored on potential, never auto-rejected — adverse decisions stay human.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No candidates in this group" compact />
      ) : (
        <ol className="mt-2 space-y-2">
          {rows.map((c, i) => (
            <CandidateCard
              key={c.candidateId || `${c.label}-${i}`}
              c={c}
              added={added(c.candidateId)}
              adding={adding(c.candidateId)}
              error={error(c.candidateId)}
              onAdd={() => onAdd(c)}
              reached={reached(c.candidateId)}
              reaching={reaching(c.candidateId)}
              reachError={reachError(c.candidateId)}
              onReach={() => onReach(c)}
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
  reached,
  reaching,
  reachError,
  onReach,
}: {
  c: CandRow;
  added: boolean;
  adding: boolean;
  error: string | null;
  onAdd: () => void;
  reached: boolean;
  reaching: boolean;
  reachError: string | null;
  onReach: () => void;
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
        <span className="ml-auto flex items-center gap-1.5">
          {early && c.potentialScore != null ? (
            <span className="text-sm text-steel">potential {Math.round(c.potentialScore * 100)}</span>
          ) : null}
          {reached ? (
            // Reaching out also filed them into the pipeline, so a reached candidate
            // collapses to one badge — no redundant "+ pipeline" button.
            <span className="rounded bg-moss/10 px-1.5 py-0.5 text-sm font-semibold text-moss">✓ Reached out</span>
          ) : (
            <>
              <button
                type="button"
                onClick={onReach}
                disabled={reaching}
                title={reachError ?? "Add to the pipeline and send a first-touch message"}
                className={`focus-ring rounded px-1.5 py-0.5 text-sm font-semibold ${
                  reachError
                    ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                    : "border border-coral/40 bg-coral/5 text-coral hover:bg-coral/10 disabled:opacity-40"
                }`}
              >
                {reaching ? "Reaching…" : reachError ? "↻ retry" : "Reach out"}
              </button>
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
            </>
          )}
        </span>
      </div>
      {error && !added ? (
        <p className="mt-1 text-sm text-red-700">Couldn&apos;t add to the pipeline — {error}</p>
      ) : null}
      {reachError && !reached ? (
        <p className="mt-1 text-sm text-red-700">Couldn&apos;t reach out — {reachError}</p>
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
