"use client";

// Full-analysis modal — the "Bench" peer-comparison workspace (winner of the
// /prototype round, 2026-08-10): a near-fullscreen modal that treats the
// advance/reject as a FIELD question — verdict band, the AI's narrative, the
// evidence sections, and a ranked bench of the role's other candidates beside
// them. Layout + sections live in DecisionsAnalysisModalBench.tsx; the shared
// section pieces in DecisionsAnalysisParts.tsx; data in
// decisionsAnalysisSummaryData.ts (resolved once here).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { useAnalysisSummaryData } from "./decisionsAnalysisSummaryData";
import { AnalysisModalBench } from "./DecisionsAnalysisModalBench";

export function AnalysisSummaryModal({
  entry,
  onClose,
  onAccept,
  onReject,
}: {
  entry: Entry;
  onClose: () => void;
  // The optional decision note (DEC4) the recruiter typed below — recorded on the
  // advanced/rejected event and shown in the Decision Log.
  onAccept: (reason?: string) => void;
  onReject: (reason?: string) => void;
}) {
  const t = useTranslations("decisions.summary");
  const enumLabel = useEnumLabel();
  const [reason, setReason] = useState("");
  const data = useAnalysisSummaryData(entry);

  return (
    <AnalysisModalBench
      entry={entry}
      data={data}
      reason={reason}
      setReason={setReason}
      onClose={onClose}
      onAccept={onAccept}
      onReject={onReject}
      t={t}
      enumLabel={enumLabel}
    />
  );
}
