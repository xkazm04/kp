"use client";

import { AlertTriangle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CoachHandoffBlock } from "./jdsLibrary";

// winnability-apply — the honest, dismissible trace for a coach handoff that landed
// on a target it couldn't stage. The one-shot ?coachEdit= param is already spent by
// the time the ledger renders, so without this the suggestion vanishes with no cue.
// Worded per cause: still building (arms itself when the poll flips it to ready — the
// note yields to the editor's staged banner), build failed, or no matching JD. Amber
// caution tone (dark-mapped) matches the ledger's other advisory surfaces. Extracted
// verbatim from LibrarySavedJdsLedger.tsx so that file stays under the 200-line split
// threshold.
export function CoachHandoffTrace({
  cause,
  slug,
  title,
  onDismiss,
}: {
  cause: CoachHandoffBlock;
  slug: string;
  title?: string;
  onDismiss: () => void;
}) {
  const t = useTranslations("library.tab");
  const label = title || slug;
  const message =
    cause === "analyzing"
      ? t("coachTraceAnalyzing", { title: label })
      : cause === "failed"
        ? t("coachTraceFailed", { title: label })
        : t("coachTraceNotFound", { slug });
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5"
    >
      <p className="text-sm text-ink">
        <AlertTriangle size={14} className="-mt-0.5 mr-1 inline text-amber-500" aria-hidden />
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("coachTraceDismiss")}
        className="focus-ring rounded p-0.5 text-steel hover:text-ink"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
