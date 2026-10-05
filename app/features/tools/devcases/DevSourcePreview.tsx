"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import {
  defaultPicks,
  commitSummary,
  type CandidatePreviewRow,
  type CommitSummaryResult,
} from "@/app/_lib/devcase-source-pick";

export function DevSourcePreview({
  caseId,
  onClose,
  onFiled,
}: {
  caseId: string;
  onClose: () => void;
  onFiled?: (added: number) => void;
}) {
  const t = useTranslations("devcase.studio.sourcePreview");
  const errorMessage = useErrorMessage();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogA11y(ref, onClose, { trap: true, lockScroll: false });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidatePreviewRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<CommitSummaryResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/devcase/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, preview: true }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          candidates?: CandidatePreviewRow[];
          skipped?: number;
          error?: string;
          code?: string;
        } | null;

        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setError(errorMessage(data, t("previewFailed")));
          return;
        }

        const rows = data.candidates ?? [];
        setCandidates(rows);
        setSkipped(data.skipped ?? 0);
        setSelected(new Set(defaultPicks(rows)));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("previewFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [caseId, errorMessage, t]);

  const handleFile = async () => {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const candidateIds = Array.from(selected);
      const res = await fetch("/api/devcase/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, candidateIds }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        added?: number;
        alreadyOnBoard?: number;
        dropped?: string[];
        error?: string;
        code?: string;
      } | null;

      if (!res.ok || !data?.ok) {
        setError(errorMessage(data, t("filingFailed")));
        setSubmitting(false);
        return;
      }

      const added = data.added ?? 0;
      const alreadyOnBoard = data.alreadyOnBoard ?? 0;
      const dropped = data.dropped ?? [];
      const sum = commitSummary({ added, alreadyOnBoard, dropped });
      setSummary(sum);
      onFiled?.(added);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("filingFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      tabIndex={-1}
      className="rounded-lg border border-coral/30 bg-coral/5 p-4"
    >
      <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
        <Users size={13} /> {t("title")}
      </h3>
      <p className="mt-1 text-sm text-steel">{t("subtitle")}</p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-micro text-steel">
          <Loader2 className="animate-spin" size={14} /> {t("loading")}
        </div>
      ) : summary ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-moss/30 bg-moss/10 p-3 text-sm text-moss-dark">
            {summary.key === "filed" ? (
              <p>
                {t("summaryFiled", {
                  added: summary.added,
                  alreadyOnBoard: summary.alreadyOnBoard,
                })}
              </p>
            ) : summary.key === "nothingNew" ? (
              <p>
                {t("summaryNothingNew", {
                  alreadyOnBoard: summary.alreadyOnBoard,
                })}
              </p>
            ) : (
              <p>{t("summaryDropped", { dropped: summary.dropped })}</p>
            )}
            {summary.key === "filed" && summary.dropped > 0 ? (
              <p className="mt-1 text-micro text-amber-700">
                {t("summaryDropped", { dropped: summary.dropped })}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="focus-ring inline-flex h-8 items-center rounded-md bg-stone-900 px-3 text-micro font-semibold text-white hover:bg-stone-800"
            >
              {t("done")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {candidates.length === 0 ? (
            <div className="text-micro text-steel">
              {skipped > 0
                ? t("emptySkipped", { count: skipped })
                : t("emptyPool")}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-micro">
                <span className="font-semibold text-ink">
                  {t("matchesCount", { total: candidates.length })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        new Set(
                          candidates
                            .map((c) => c.candidateId)
                            .filter((id): id is string => Boolean(id))
                        )
                      )
                    }
                    className="font-medium text-coral hover:underline"
                  >
                    {t("selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="font-medium text-steel hover:underline"
                  >
                    {t("deselectAll")}
                  </button>
                </div>
              </div>

              <div className="max-h-60 space-y-2 overflow-y-auto">
                {candidates.map((row) => {
                  const id = row.candidateId;
                  const isChecked = id ? selected.has(id) : false;
                  return (
                    <label
                      key={id ?? row.label}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md border border-stone-200 bg-white p-2.5 hover:border-stone-300"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!id}
                        onChange={() => {
                          if (!id) return;
                          const next = new Set(selected);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          setSelected(next);
                        }}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">
                            {row.label}
                          </span>
                          {row.archetype ? (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-micro text-steel">
                              {row.archetype}
                            </span>
                          ) : null}
                          {row.score != null ? (
                            <span className="rounded bg-moss/10 px-1.5 py-0.5 text-micro font-medium text-moss">
                              {t("score", { score: row.score })}
                            </span>
                          ) : null}
                          {row.onBoard ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-micro font-medium text-amber-800">
                              {t("onBoardBadge", {
                                status: row.onBoard.status,
                              })}
                            </span>
                          ) : null}
                        </div>
                        {row.matchedSkills && row.matchedSkills.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.matchedSkills.map((skill) => (
                              <span
                                key={skill}
                                className="rounded bg-stone-50 px-1.5 py-0.5 text-micro text-steel"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={handleFile}
                    disabled={selected.size === 0 || submitting}
                    className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-micro font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
                  >
                    <Users size={12} />
                    {submitting
                      ? t("filing")
                      : t("fileCta", { count: selected.size })}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink disabled:opacity-50"
                  >
                    {t("cancel")}
                  </button>
                </div>
                {skipped > 0 ? (
                  <span className="text-micro text-steel">
                    {t("emptySkipped", { count: skipped })}
                  </span>
                ) : null}
              </div>
            </>
          )}

          {error ? (
            <p role="alert" className="mt-2 text-micro text-coral">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
