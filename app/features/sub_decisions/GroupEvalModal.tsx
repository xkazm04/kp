"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { AiVerdict } from "./group-eval/AiVerdict";
import { ComparisonTable } from "./group-eval/ComparisonTable";
import { FairnessPanel } from "./group-eval/FairnessPanel";
import { sourceLabelKey } from "./group-eval/helpers";
import { LegacyView } from "./group-eval/LegacyView";
import { Notices } from "./group-eval/Notices";
import { PerCandidateTabs } from "./group-eval/PerCandidateTabs";
import { Risks } from "./group-eval/Risks";
import type { GroupEvalPayload } from "./group-eval/types";
import { useGroupEval } from "./group-eval/useGroupEval";

// The group-eval contract (payload, candidates, fairness) and the candIdentity
// keying rule live in ./group-eval/types; re-exported here so consumers keep
// importing them from the modal's public entry point.
export { candIdentity } from "./group-eval/types";
export type { Comparison, EvalCandidate, Fairness, FairnessScheme, GroupEvalPayload } from "./group-eval/types";

export function GroupEvalModal({
  roleTitle,
  evaluation,
  loading,
  error,
  createdAt,
  poolDrift,
  onClose,
  onRerun,
  onDecide,
}: {
  roleTitle: string;
  evaluation: GroupEvalPayload | null;
  loading: boolean;
  /** Explicit unavailable/timed-out message. When set (and there's no evaluation),
   *  the modal shows an honest "evaluation unavailable" notice instead of the
   *  ambiguous "no evaluation yet" empty state — used by the simulation when the
   *  group-eval poll times out. */
  error?: string | null;
  /** When the cached evaluation was generated (ISO); null for a fresh run. */
  createdAt?: string | null;
  /** How many candidates were added/removed from the role's pool since this
   *  evaluation ran. > 0 means the comparison may be stale. */
  poolDrift?: number;
  onClose: () => void;
  onRerun: () => void;
  /** Advance/reject a candidate inline from the comparison (DEC3). The first arg is the
   *  candidate IDENTITY (candIdentity: entry id, label fallback), resolved back to the live
   *  pipeline entry by id in DecisionsTab so a duplicate display name can't act on the wrong
   *  person. Omitted (read-only) for the simulation, which has no live decision queue. */
  onDecide?: (identity: string, action: "accept" | "reject") => void;
}) {
  const t = useTranslations("decisions.groupEval");
  const { ranAt, decided, decide, drift, candidates, enriched, skillRows, mustRows, aiBacked } = useGroupEval({
    evaluation,
    createdAt,
    poolDrift,
    onDecide,
  });

  return (
    <Modal
      size="full"
      title={t("title", { role: roleTitle })}
      subtitle={
        evaluation
          ? `${t("subtitleSource", { source: t(sourceLabelKey(evaluation.source) as Parameters<typeof t>[0]) })}${
              ranAt ? t("subtitleRan", { when: ranAt }) : ""
            }`
          : undefined
      }
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onRerun}
          disabled={loading}
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <RefreshCw size={14} /> {loading ? t("generating") : t("rerun")}
        </button>
      }
    >
      {loading && !evaluation ? (
        <p className="flex items-center gap-2 text-base text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> {t("generatingFull")}
        </p>
      ) : error && !evaluation ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">{t("unavailable")}</span> {error}
          </span>
        </div>
      ) : !evaluation ? (
        <p className="text-base text-steel">{t("noEval")}</p>
      ) : (
        <div className="space-y-5">
          <Notices drift={drift} ranAt={ranAt} evaluation={evaluation} />
          <AiVerdict comparison={evaluation.comparison} fallback={evaluation.summary} aiBacked={aiBacked} />

          {enriched ? (
            <>
              <ComparisonTable candidates={candidates} skillRows={skillRows} mustRows={mustRows} roleBand={evaluation.roleSalaryBand ?? []} />
              <FairnessPanel fairness={evaluation.fairness ?? null} headlineOrder={evaluation.recommendedOrder ?? []} />
              <PerCandidateTabs
                candidates={candidates}
                differentiators={evaluation.differentiators ?? []}
                topPick={evaluation.topPick?.label}
                decided={decided}
                onDecide={decide || undefined}
              />
            </>
          ) : (
            <LegacyView evaluation={evaluation} />
          )}

          <Risks risks={evaluation.risks ?? []} />
        </div>
      )}
    </Modal>
  );
}
