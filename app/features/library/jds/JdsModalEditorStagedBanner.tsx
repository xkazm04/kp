"use client";

import { Lightbulb, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";

// The dismissible "staged suggestion" banner shown when the editor was opened
// from a winnability-coach recommendation — extracted verbatim from
// JdsModalEditor.tsx so that file stays under the 200-line split threshold.
export function JdsModalEditorStagedBanner({
  suggestion,
  onDismiss,
  t,
}: {
  suggestion: CoachEdit;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  const bannerKey =
    suggestion.kind === "language"
      ? "coachStageLanguage"
      : suggestion.kind === "education"
        ? "coachStageEducation"
        : "coachStageMustHave";
  return (
    <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/5 px-3 py-2.5">
      <Lightbulb size={16} className="mt-0.5 shrink-0 text-coral" aria-hidden />
      <div className="flex-1 space-y-1">
        <p className="text-meta uppercase tracking-wide text-coral">{t("coachStageEyebrow")}</p>
        <p className="text-base text-ink">
          {t.rich(bannerKey, {
            value: suggestion.value,
            delta: suggestion.delta,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("coachStageDismiss")}
        title={t("coachStageDismiss")}
        className="focus-ring shrink-0 rounded-md p-1 text-steel transition-colors hover:text-ink"
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
