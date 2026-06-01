"use client";

import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";

export type GroupEvalPayload = {
  roleTitle?: string;
  source?: string;
  topPick?: { label: string; score: number; why: string } | null;
  recommendedOrder?: string[];
  candidates?: { label: string; score: number; seniority: string | null; verdict: string; strengths: string[]; gaps: string[] }[];
  differentiators?: string[];
  risks?: string[];
  summary?: string;
  // Coverage bookkeeping (group-eval-run): the top `cap` of `totalCandidates`
  // were compared, sorted by fit. `evaluatedLabels` is the pre-cap pool used to
  // detect drift against the role's current pending entries.
  totalCandidates?: number;
  cap?: number;
  capped?: boolean;
  evaluatedLabels?: string[];
};

const sourceLabel = (s?: string) => (s === "llm" ? "Claude/Gemini" : s === "partial" ? "Partial (some AI)" : "Deterministic");

const ranWhen = (iso?: string | null): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : null;
};

export function GroupEvalModal({
  roleTitle,
  evaluation,
  loading,
  createdAt,
  poolDrift,
  onClose,
  onRerun,
}: {
  roleTitle: string;
  evaluation: GroupEvalPayload | null;
  loading: boolean;
  /** When the cached evaluation was generated (ISO); null for a fresh run. */
  createdAt?: string | null;
  /** How many candidates were added/removed from the role's pool since this
   *  evaluation ran. > 0 means the comparison may be stale. */
  poolDrift?: number;
  onClose: () => void;
  onRerun: () => void;
}) {
  const ranAt = ranWhen(createdAt);
  const drift = poolDrift ?? 0;
  return (
    <Modal
      title={`Group evaluation · ${roleTitle}`}
      subtitle={evaluation ? `Source: ${sourceLabel(evaluation.source)}${ranAt ? ` · ran ${ranAt}` : ""}` : undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onRerun}
          disabled={loading}
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <RefreshCw size={14} /> {loading ? "Generating…" : "Re-run"}
        </button>
      }
    >
      {loading && !evaluation ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Generating group evaluation across the role&apos;s candidates…
        </p>
      ) : !evaluation ? (
        <p className="text-sm text-steel">No evaluation yet — run one to compare this role&apos;s candidates.</p>
      ) : (
        <div className="space-y-4">
          {drift > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <b>{drift} candidate{drift === 1 ? "" : "s"} changed</b> since this evaluation ran
                {ranAt ? ` (${ranAt})` : ""}. The ranking below may exclude a newly added candidate or
                recommend one already decided — re-run for an up-to-date comparison.
              </span>
            </div>
          ) : null}

          {evaluation.capped ? (
            <p className="text-meta text-steel">
              Showing top {evaluation.cap ?? evaluation.candidates?.length} of {evaluation.totalCandidates} candidates,
              ranked by fit.
            </p>
          ) : null}

          {evaluation.summary ? <p className="text-base text-ink">{evaluation.summary}</p> : null}

          {evaluation.topPick ? (
            <div className="rounded-lg border border-moss/30 bg-moss/5 p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
                <Sparkles size={13} /> Recommended lead
              </p>
              <p className="mt-1 flex items-center gap-2 font-serif text-h3 text-ink">
                {evaluation.topPick.label} <ScoreBadge score={evaluation.topPick.score} />
              </p>
              {evaluation.topPick.why ? <p className="mt-1 text-sm text-steel">{evaluation.topPick.why}</p> : null}
            </div>
          ) : null}

          {evaluation.recommendedOrder?.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">Recommended order</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-ink">
                {evaluation.recommendedOrder.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {evaluation.candidates?.length ? (
            <div className="space-y-2">
              <p className="text-meta uppercase tracking-wide text-steel">Per candidate</p>
              {evaluation.candidates.map((c, i) => (
                <div key={i} className="rounded-md border border-stone-200 p-2.5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    {c.label}
                    <ScoreBadge score={c.score} />
                    {c.seniority ? <span className="font-normal text-steel">{c.seniority}</span> : null}
                  </p>
                  {c.verdict ? <p className="mt-0.5 text-sm text-ink">{c.verdict}</p> : null}
                  <div className="mt-1 grid gap-1 sm:grid-cols-2 text-sm">
                    {c.strengths.length ? <p><span className="font-semibold text-moss">+ </span>{c.strengths.slice(0, 3).join("; ")}</p> : null}
                    {c.gaps.length ? <p><span className="font-semibold text-coral">! </span>{c.gaps.slice(0, 3).join("; ")}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {evaluation.differentiators?.length ? (
            <p className="text-sm text-ink">
              <span className="font-semibold">Differentiators (lead):</span> {evaluation.differentiators.join(", ")}
            </p>
          ) : null}

          {evaluation.risks?.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-coral">Watch-outs</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {evaluation.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
