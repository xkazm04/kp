"use client";

import { useEffect, useRef, useState } from "react";
import { Scale, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { ARCHETYPE_BADGE, isEarlyCareer, provLabel } from "./JobsTypes";
import type { CandRow, FairnessMatrix, SkippedCandidate } from "./JobsTypes";
import { EmptyState, SkippedCandidatesNote } from "./JobsShared";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useAddToPipeline } from "@/app/_lib/useAddToPipeline";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useReachOut } from "@/app/_lib/useReachOut";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
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
  const t = useTranslations("jobs.candidates");
  const [data, setData] = useState<{
    candidates: CandRow[];
    skipped?: SkippedCandidate[];
    fairness?: FairnessMatrix | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // e1e4e0ea — when on, rank by the robust cross-scheme mean instead of each
  // candidate's own-weight score, and surface the own-vs-robust delta.
  const [fairRank, setFairRank] = useState(false);
  // The jobId whose candidates are currently loaded — so auto-load fires once per job
  // (mount AND when the reused modal switches jobs), not just on first mount.
  const loadedJobRef = useRef<string | null>(null);
  const { add, added, adding, error: cardError, announce } = useAddToPipeline(jobId, jobTitle, "sourcing");
  const { reach, reached, reaching, error: reachError, announce: reachAnnounce } = useReachOut(jobId);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/candidates`);
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? t("failedStatus", { status: r.status }));
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("failed"));
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
    const timer = window.setTimeout(() => {
      // Fire once per jobId: on mount AND when the reused modal switches jobs (the old
      // `!data` guard kept showing the previous job's candidates because data was non-null).
      if (loadedJobRef.current !== jobId && !loading) {
        loadedJobRef.current = jobId;
        load();
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, jobId]);

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
          {loading ? t("scoring") : t("scoreCandidates")}
        </button>
        {error ? <span className="ml-2 text-sm text-red-700">{error}</span> : null}
      </div>
    );
  }

  const eligible = data.candidates.filter((c) => c.koPassed);
  const earlyCareer = eligible.filter((c) => isEarlyCareer(c.archetype));
  const experienced = eligible.filter((c) => !isEarlyCareer(c.archetype));
  const notEligibleRows = data.candidates.filter((c) => !c.koPassed);
  const notEligible = notEligibleRows.length;
  const skipped = data.skipped ?? [];

  // e1e4e0ea — index the cross-scheme fairness matrix by candidateId so each card
  // can show its robust mean + own-vs-robust delta, and the columns can re-rank by
  // robustness. Guarded: needs aligned candidateIds and ≥2 candidates to matter.
  const fairness = data.fairness ?? null;
  const fairById = new Map<string, { own: number; mean: number; delta: number }>();
  if (fairness?.candidateIds && fairness.candidateIds.length === fairness.mean.length) {
    fairness.candidateIds.forEach((cid, i) => {
      const own = fairness.own[i] ?? 0;
      const mean = fairness.mean[i] ?? 0;
      fairById.set(cid, { own, mean, delta: mean - own });
    });
  }
  const hasFairness = fairById.size >= 2;
  const fairActive = fairRank && hasFairness;
  // Fair Rank on → order each column by the robust mean (desc); else keep the
  // engine's eligible-then-own-score order.
  const orderRows = (rows: CandRow[]): CandRow[] =>
    fairActive
      ? [...rows].sort(
          (a, b) =>
            (fairById.get(b.candidateId)?.mean ?? b.result.total) - (fairById.get(a.candidateId)?.mean ?? a.result.total)
        )
      : rows;

  // Export the auditable matrix: per-scheme scores (matrix[i] = candidate i under
  // every candidate's weights) plus own / robust / delta. Reuses the shared CSV toolkit.
  const exportFairness = () => {
    if (!fairness) return;
    const header = ["Candidate", "Own", "Robust (mean)", "Delta", ...fairness.labels.map((l) => `under ${l}`)];
    const rows = fairness.labels.map((label, i) => [
      label,
      fairness.own[i] ?? "",
      fairness.mean[i] ?? "",
      (fairness.mean[i] ?? 0) - (fairness.own[i] ?? 0),
      ...(fairness.matrix[i] ?? []),
    ]);
    const name = `fair-rank-${(jobTitle || "role").replace(/\s+/g, "-")}.csv`;
    downloadFile(name, toCsv([header, ...rows]), "text/csv");
  };

  return (
    <div className="rounded-md border border-stone-200 p-3">
      <p role="status" aria-live="polite" className="sr-only">
        {[announce, reachAnnounce].filter(Boolean).join(" ")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-coral">
          {t("title")}
        </p>
        <div className="flex items-center gap-2">
          {hasFairness ? (
            <button
              type="button"
              onClick={() => setFairRank((v) => !v)}
              aria-pressed={fairRank}
              title={t("fairRankTitle")}
              className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
                fairActive ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
              }`}
            >
              <Scale size={13} /> {t("fairRank")}
            </button>
          ) : null}
          <span className="text-sm text-steel">{t("notEligible", { count: notEligible })}</span>
        </div>
      </div>
      <p className="mt-1 text-sm text-steel">{t("earlyCareerNote")}</p>
      {fairActive ? <p className="mt-1 text-sm text-steel">{t("fairRankNote")}</p> : null}
      <SkippedCandidatesNote skipped={skipped} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <CandidateColumn
          title={t("experienced")}
          rows={orderRows(experienced)}
          added={added}
          adding={adding}
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
          fair={fairActive ? (id) => fairById.get(id) : undefined}
        />
        <CandidateColumn
          title={t("earlyCareerPipeline")}
          rows={orderRows(earlyCareer)}
          highlight
          added={added}
          adding={adding}
          error={cardError}
          onAdd={addToPipeline}
          reached={reached}
          reaching={reaching}
          reachError={reachError}
          onReach={reachOut}
          fair={fairActive ? (id) => fairById.get(id) : undefined}
        />
      </div>
      {hasFairness ? (
        <FairnessAuditPanel fairness={fairness!} fairById={fairById} onExport={exportFairness} />
      ) : null}
      <NotEligibleSection rows={notEligibleRows} />
    </div>
  );
}

// JOB4 — the ranker has always shipped per-candidate KO reasons for the
// not-eligible cohort; this UI reduced them to a bare count, so "12 not
// eligible" couldn't tell a recruiter whether the pool lacks German or is one
// year short. Collapsed disclosure, near-misses (a single KO reason) first —
// they're the candidates a relaxed must-have on the JD might rescue. Reason
// strings are the engine's candidate-facing detail clauses, shown verbatim.
function NotEligibleSection({ rows }: { rows: CandRow[] }) {
  const t = useTranslations("jobs.candidates");
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.koReasons.length - b.koReasons.length);
  return (
    <details className="mt-3 rounded-md border border-stone-200 bg-paper/50 px-3 py-2">
      <summary className="focus-ring cursor-pointer text-sm font-semibold text-steel hover:text-ink">
        {t("notEligibleWhy", { count: rows.length })}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {sorted.map((c) => (
          <li key={c.candidateId} className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="font-medium text-ink">{c.label}</span>
            <span className="rounded-full bg-ink/90 px-1.5 py-0.5 text-xs font-semibold text-white">
              {ARCHETYPE_BADGE[c.archetype] ?? c.archetype}
            </span>
            {c.koReasons.length === 1 ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {t("nearMiss")}
              </span>
            ) : null}
            <span className="text-steel">{c.koReasons.join("; ")}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// e1e4e0ea — the auditable cross-scheme view: every candidate's own vs robust
// (mean-across-all-schemes) score + delta, sorted by robustness, with a CSV export
// of the full per-scheme matrix. The bias-defensible artifact a compliance review asks for.
function FairnessAuditPanel({
  fairness,
  fairById,
  onExport,
}: {
  fairness: FairnessMatrix;
  fairById: Map<string, { own: number; mean: number; delta: number }>;
  onExport: () => void;
}) {
  const t = useTranslations("jobs.candidates");
  const ids = fairness.candidateIds ?? fairness.labels.map((_, i) => String(i));
  const rows = ids
    .map((cid, i) => ({
      label: fairness.labels[i] ?? cid,
      ...(fairById.get(cid) ?? {
        own: fairness.own[i] ?? 0,
        mean: fairness.mean[i] ?? 0,
        delta: (fairness.mean[i] ?? 0) - (fairness.own[i] ?? 0),
      }),
    }))
    .sort((a, b) => b.mean - a.mean);
  return (
    <details className="mt-3 rounded-md border border-stone-200 bg-paper/40 px-3 py-2">
      <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-steel hover:text-ink">
        <Scale size={13} className="text-coral" /> {t("fairnessAudit")}
      </summary>
      <p className="mt-2 text-sm text-steel">{t("fairnessAuditHelp")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel">
              <th className="py-1 pr-3 font-semibold">{t("auditCandidate")}</th>
              <th className="py-1 pr-3 font-semibold">{t("auditOwn")}</th>
              <th className="py-1 pr-3 font-semibold">{t("auditRobust")}</th>
              <th className="py-1 font-semibold">{t("auditDelta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-stone-100">
                <td className="py-1 pr-3 text-ink">{r.label}</td>
                <td className="nums py-1 pr-3 text-steel">{r.own}</td>
                <td className="nums py-1 pr-3 font-semibold text-ink">{r.mean}</td>
                <td className={`nums py-1 font-semibold ${r.delta >= 0 ? "text-moss" : "text-amber-700"}`}>
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onExport}
        className="focus-ring mt-2 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/50"
      >
        {t("fairnessAuditExport")}
      </button>
    </details>
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
  fair,
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
  // e1e4e0ea — robust-mean lookup when Fair Rank is active; undefined otherwise.
  fair?: (id: string) => { own: number; mean: number; delta: number } | undefined;
}) {
  const t = useTranslations("jobs.candidates");
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-green-200 bg-green-50/40" : "border-stone-200"}`}>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">
        {`${title} (${rows.length})`}
      </p>
      {highlight ? (
        // The fairness guarantee, stated where the candidates actually are — not
        // only in the policy modal: this cohort is scored on potential and is
        // structurally shielded from automated rejection.
        <p className="mt-0.5 text-sm text-steel">{t("fairnessShielded")}</p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Users} title={t("noCandidatesInGroup")} compact />
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
              fair={fair?.(c.candidateId)}
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
  fair,
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
  // e1e4e0ea — robust mean + own-vs-robust delta, present only in Fair Rank mode.
  fair?: { own: number; mean: number; delta: number };
}) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  const res = c.result;
  const early = isEarlyCareer(c.archetype);
  const prov = res.matchedSkillProvenance ?? {};
  // W8-5 — persisted state (server decoration) OR in-session optimism: a
  // candidate reached/filed yesterday must not show fresh, active buttons.
  const wasReached = reached || Boolean(c.outreachSent);
  const persistedStage = c.inPipeline ?? null;
  return (
    <li className="rounded-md border border-stone-200 bg-white p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={res.total} />
        {fair ? (
          // e1e4e0ea — the robust (cross-scheme mean) score + delta vs the
          // candidate's own-weight score. Positive Δ = strong under everyone's
          // yardsticks; negative = flattered by their own weights.
          <span
            title={t("robustTitle", { own: fair.own })}
            className={`nums rounded px-1.5 py-0.5 text-sm font-semibold ${fair.delta >= 0 ? "bg-moss/10 text-moss" : "bg-amber-100 text-amber-800"}`}
          >
            {t("robustBadge", { mean: fair.mean, delta: `${fair.delta >= 0 ? "+" : ""}${fair.delta}` })}
          </span>
        ) : null}
        <ConfidenceRange low={res.confidence.low} high={res.confidence.high} drivers={res.confidence.drivers} className="nums text-sm text-steel" />
        <ConfidenceBandBadge level={res.confidence.level} drivers={res.confidence.drivers} />
        <span className="font-medium text-ink">{c.label}</span>
        <span className="rounded-full bg-ink/90 px-1.5 py-0.5 text-sm font-semibold text-white">
          {ARCHETYPE_BADGE[c.archetype] ?? c.archetype}
        </span>
        <FitTierBadge tier={res.fitTier} score={res.total} />
        <span className="ml-auto flex items-center gap-1.5">
          {early && c.potentialScore != null ? (
            <PotentialBadge
              potential={{
                score: c.potentialScore,
                learningSignals: c.learningSignals,
                transferableSkills: c.transferableSkills,
                domainDistance: c.domainDistance,
              }}
            />
          ) : null}
          {wasReached ? (
            // Reaching out also filed them into the pipeline, so a reached candidate
            // collapses to one badge — no redundant "+ pipeline" button.
            <span className="rounded bg-moss/10 px-1.5 py-0.5 text-sm font-semibold text-moss">{t("reachedOut")}</span>
          ) : (
            <>
              <button
                type="button"
                onClick={onReach}
                disabled={reaching}
                title={reachError ?? t("reachTitle")}
                className={`focus-ring rounded px-1.5 py-0.5 text-sm font-semibold ${
                  reachError
                    ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40"
                    : "border border-coral/40 bg-coral/5 text-coral hover:bg-coral/10 disabled:opacity-40"
                }`}
              >
                {reaching ? t("reaching") : reachError ? t("retry") : t("reachOut")}
              </button>
              {persistedStage && !added ? (
                // Already filed for THIS job (a prior session) — show where they
                // are instead of an add button the server would no-op anyway.
                <span className="rounded bg-moss/10 px-1.5 py-0.5 text-sm font-semibold text-moss">
                  {t("inPipelineStage", { stage: enumLabel("stage", persistedStage) })}
                </span>
              ) : (
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
                  {added ? t("inPipeline") : adding ? t("addingShort") : error ? t("retry") : t("addPipeline")}
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {error && !added ? (
        <p className="mt-1 text-sm text-red-700">{t("couldntAdd", { error })}</p>
      ) : null}
      {reachError && !reached ? (
        <p className="mt-1 text-sm text-red-700">{t("couldntReach", { error: reachError })}</p>
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
            {`✗ ${s}`}
          </span>
        ))}
      </div>
      {c.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">{t("assumptions")}</span> {c.assumptions[0]}
        </p>
      ) : null}
    </li>
  );
}
