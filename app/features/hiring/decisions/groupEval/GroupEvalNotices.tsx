import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// Staleness banners above the evaluation: pool drift since the eval ran, and the
// "top N of M compared" coverage note for capped runs.
export function Notices({ drift, ranAt, evaluation }: { drift: number; ranAt: string | null; evaluation: GroupEvalPayload }) {
  const t = useTranslations("decisions.groupEval");
  return (
    <>
      {drift > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-base text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t.rich("driftNotice", { count: drift, when: ranAt ? ` (${ranAt})` : "", b: (chunks) => <b>{chunks}</b> })}
          </span>
        </div>
      ) : null}
      {/* group-eval-cohort-choice — an explicit selection discloses "your selection
          of N of M"; the default top-N run discloses the capped coverage. Mutually
          exclusive (the server sets `capped` false when a selection was used). */}
      {evaluation.selection ? (
        <p className="text-sm text-steel">
          {t("selectionNote", { count: evaluation.selection.count, total: evaluation.selection.total })}
        </p>
      ) : evaluation.capped ? (
        <p className="text-sm text-steel">
          {t("capped", { cap: evaluation.cap ?? evaluation.candidates?.length ?? 0, total: evaluation.totalCandidates ?? 0 })}
        </p>
      ) : null}
    </>
  );
}
