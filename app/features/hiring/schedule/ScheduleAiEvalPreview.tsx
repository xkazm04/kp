"use client";

// The COMPACT evaluation preview the AI-round docket opens on a completed
// interview: verdict-first (recommendation badge + confidence), the summary
// paragraph, and the per-competency rubric dots — enough to triage in ten
// seconds. The full transcript & scorecard modal (evidence quotes, telemetry,
// read-back) stays one click deeper via the footer button.
import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { RATING_MAX } from "@/app/_lib/format";
import { rubricLabel } from "@/app/_lib/interview-rubric";
import { useRubricStrings } from "@/app/_lib/use-rubric-strings";
import { cleanRating, type Session } from "./scheduleInterviewTranscriptHelpers";
import type { EvalTarget } from "./ScheduleAiRound";

const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

export function ScheduleAiEvalPreview({
  target,
  onClose,
  onOpenFull,
}: {
  target: EvalTarget;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const t = useTranslations("scheduleTab.transcript");
  const tAi = useTranslations("scheduleTab.aiRound");
  const enumLabel = useEnumLabel();
  // PREP3 — the stored canonical competency rendered in the reader's language,
  // exactly like the full modal's ScorecardRatingRow. Without it this preview was
  // the one scorecard surface still showing raw English axis names to a cs/de/fr
  // recruiter, one click before the same axes appear translated.
  const rubricStrings = useRubricStrings();
  const { data, error } = useJsonFetch<{ session?: Session }>(
    `/api/interview/by-entry?entry=${encodeURIComponent(target.id)}`,
    t("loadFailed")
  );
  const sc = data?.session?.scorecard ?? null;
  // Confidence rides the scorecard object at runtime (interview-run.ts) but is
  // not part of the pure Scorecard type — read it through a narrow guard so
  // absence degrades to no chrome.
  const confidence = (sc as { confidence?: { level?: string; reason?: string } } | null)?.confidence ?? null;
  const loading = data === null && error === null;

  return (
    <Modal
      size="lg"
      title={target.candidateLabel}
      subtitle={target.jobTitle ?? undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onOpenFull}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
        >
          <FileText size={14} className="text-coral" /> {tAi("fullTranscript")}
        </button>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={15} className="animate-spin text-coral" /> {t("loading")}
        </p>
      ) : error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : !sc ? (
        <p className="text-sm text-steel">{tAi("noScorecardHelp")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {sc.recommendation ? (
              <Badge {...interviewRecommendationToken(sc.recommendation)} label={enumLabel("recommendation", sc.recommendation)} />
            ) : null}
            {confidence?.level ? (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel" title={confidence.reason ?? undefined}>
                {tAi("confidence", { level: confidence.level })}
              </span>
            ) : null}
          </div>
          {sc.summary ? <p className="text-body text-ink">{sc.summary}</p> : null}
          {sc.ratings?.length ? (
            <ul className="space-y-1.5 rounded-md border border-stone-200 bg-paper/50 p-3">
              {sc.ratings.map((r, i) => {
                // Same trust-boundary coercion the full modal applies: the stored
                // scorecard JSON is returned verbatim, so a legacy row / partial
                // synthesis can carry a null, string or out-of-range rating. A null
                // one rendered as five EMPTY dots — "not measured" disguised as a
                // zero score — so say "not assessed" instead, as the full modal does.
                const rating = cleanRating(r.rating);
                const label = rubricLabel(r.competency, rubricStrings);
                return (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-steel">{label}</span>
                    {rating != null ? (
                      // role=img + one label: the dots are the only carrier of the
                      // value, and colour alone says nothing to a screen reader.
                      <span
                        className="flex shrink-0 gap-0.5"
                        role="img"
                        aria-label={t("ratingAria", { competency: label, rating, max: RATING_MAX })}
                      >
                        {RATING_SCALE.map((n) => (
                          <span key={n} aria-hidden className={`h-2 w-2 rounded-full ${n <= rating ? "bg-moss" : "bg-stone-200"}`} />
                        ))}
                      </span>
                    ) : (
                      <span className="shrink-0 text-sm text-steel">{t("notAssessed")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
