"use client";

// The interview-prep modal's pre-content states: initial load, in-flight
// generation with nothing yet, a load error (distinct from "no prep yet", with
// retry + generate-fresh), and the genuine empty state. Split out of
// ScheduleInterviewPrepModal.tsx to keep the modal file under the 200-line cap.

import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { useTranslations } from "next-intl";

export function PrepLoadStates({
  loading,
  generating,
  error,
  reload,
  generate,
  t,
}: {
  loading: boolean;
  generating: boolean;
  error: string | null;
  reload: () => void;
  generate: () => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  if (loading) return <p className="text-sm text-steel">{t("loading")}</p>;
  if (generating) {
    return (
      <p className="flex items-center gap-2 text-sm text-steel">
        <Loader2 size={16} className="animate-spin text-coral" /> {t("generatingPlan")}
      </p>
    );
  }
  if (error) {
    // Distinct failure state: a 500 / DB lock / parse error must never read as
    // "no prep yet". Offer a retry (re-fetch) and a generate-fresh path.
    return (
      <div className="text-center">
        <p className="flex items-center justify-center gap-2 text-sm text-coral">
          <AlertTriangle size={15} /> {error}
        </p>
        <p className="mt-1 text-meta text-steel">{t("loadErrorHint")}</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            <RefreshCw size={14} /> {t("retry")}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles size={16} /> {t("generate")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <p className="text-sm text-steel">{t("noPrep")}</p>
      <button
        type="button"
        onClick={generate}
        className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
      >
        <Sparkles size={16} /> {t("generatePrep")}
      </button>
    </div>
  );
}
