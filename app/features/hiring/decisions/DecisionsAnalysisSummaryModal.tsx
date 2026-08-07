"use client";

// Read-only analysis summary derived from the profile data already gathered for
// this candidate (no new AI call) + the deterministic match breakdown for the
// role, with the advance/reject decision in the footer. Data-fetching lives in
// decisionsAnalysisSummaryData.ts and the evidence sections render via
// DecisionsAnalysisSummaryBody — split out to keep this shell under 200 lines.
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { TextArea } from "@/app/_components/TextArea";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ScoreBreakdown, useConfidenceBandCopy, useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { useAnalysisSummaryData } from "./decisionsAnalysisSummaryData";
import { DecisionsAnalysisSummaryBody } from "./DecisionsAnalysisSummaryBody";

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
  const bandCopy = useConfidenceBandCopy();
  const fitLabels = useFitTierLabels();
  const [reason, setReason] = useState("");
  const { payload, loading, match, matchLoading, skills, matchProv, unproven, unprovenReason, unprovenStrength, unprovenLabelKey } =
    useAnalysisSummaryData(entry);

  return (
    <Modal
      size="3xl"
      title={entry.candidateLabel}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => onReject(reason)}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <X size={15} /> {t("reject")}
          </button>
          <button
            type="button"
            onClick={() => onAccept(reason)}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90"
          >
            <Check size={15} /> {t("advance")}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          {t("fit")} <ScoreBadge score={match?.total ?? entry.matchScore ?? null} />
        </span>
        <FitTierBadge tier={match?.fitTier} score={match?.total ?? entry.matchScore ?? undefined} labels={fitLabels} />
        {match?.confidence ? (
          <span className="inline-flex items-center gap-1.5">
            <ConfidenceRange low={match.confidence.low} high={match.confidence.high} drivers={match.confidence.drivers} copy={bandCopy} className="nums text-sm text-steel" />
            <ConfidenceBandBadge level={match.confidence.level} drivers={match.confidence.drivers} copy={bandCopy} />
          </span>
        ) : null}
        {payload?.seniority ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("seniority", payload.seniority)}</span> : null}
        {payload?.yearsExperience != null ? (
          <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{t("years", { years: payload.yearsExperience })}</span>
        ) : null}
        {payload?.educationLevel ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("education", payload.educationLevel)}</span> : null}
        {payload?.location ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-steel">{payload.location}</span> : null}
      </div>

      {/* Weight-aware score breakdown for this role (where the fit comes from). */}
      {match?.scoreBreakdown?.length ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("whereFit")}</p>
          <ScoreBreakdown dims={match.scoreBreakdown} total={match.total} />
        </div>
      ) : matchLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-steel">
          <Loader2 size={14} className="animate-spin text-coral" /> {t("scoringRole")}
        </p>
      ) : null}

      <DecisionsAnalysisSummaryBody
        match={match}
        matchProv={matchProv}
        unproven={unproven}
        unprovenReason={unprovenReason}
        unprovenStrength={unprovenStrength}
        unprovenLabelKey={unprovenLabelKey}
        loading={loading}
        payload={payload}
        skills={skills}
        t={t}
        enumLabel={enumLabel}
      />

      <div className="mt-4 border-t border-stone-200 pt-4">
        <label htmlFor="decision-note" className="text-meta uppercase tracking-wide text-steel">
          {t("decisionNote")} <span className="font-normal normal-case text-steel/70">{t("decisionNoteOptional")}</span>
        </label>
        <TextArea
          id="decision-note"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t("notePlaceholder")}
          sizeVariant="sm"
          className="mt-1.5"
        />
      </div>
    </Modal>
  );
}
