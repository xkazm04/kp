"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, RefreshCw, Scale } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { AiVerdict } from "@/app/features/hiring/decisions/groupEval/GroupEvalAiVerdict";
import { ComparisonTable } from "@/app/features/hiring/decisions/groupEval/GroupEvalComparisonTable";
import { FairnessPanel } from "@/app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel";
import { sourceLabelKey } from "@/app/features/hiring/decisions/groupEval/groupEvalHelpers";
import { governanceText, summaryText, type Translate } from "./groupEval/localize";
import { LegacyView } from "@/app/features/hiring/decisions/groupEval/GroupEvalLegacyView";
import { Notices } from "@/app/features/hiring/decisions/groupEval/GroupEvalNotices";
import type { GovernanceCacheMismatch } from "@/app/features/hiring/decisions/groupEval/governanceCacheSync";
import { PerCandidateTabs } from "@/app/features/hiring/decisions/groupEval/GroupEvalPerCandidateTabs";
import { Risks } from "@/app/features/hiring/decisions/groupEval/GroupEvalRisks";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import { useGroupEval } from "@/app/features/hiring/decisions/groupEval/useGroupEval";

// The group-eval contract (payload, candidates, fairness) and the candIdentity
// keying rule live in ./group-eval/types; re-exported here so consumers keep
// importing them from the modal's public entry point.
export { candIdentity } from "@/app/features/shared/groupEvalTypes";
export type { Comparison, EvalCandidate, Fairness, FairnessScheme, GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

export function GroupEvalModal({
  roleTitle,
  evaluation,
  loading,
  error,
  createdAt,
  poolDrift,
  governanceMismatch,
  onClose,
  onRerun,
  onDecide,
  sealed,
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
  /** Set when this SAVED evaluation ran under a different governance mode than the
   *  control now shows (see groupEval/governanceCacheSync.ts). The modal discloses it
   *  rather than letting a comparison answer a question it was not asked. */
  governanceMismatch?: GovernanceCacheMismatch | null;
  onClose: () => void;
  onRerun: () => void;
  /** Advance/reject a candidate inline from the comparison (DEC3). The first arg is the
   *  candidate IDENTITY (candIdentity: entry id, label fallback), resolved back to the live
   *  pipeline entry by id in DecisionsTab so a duplicate display name can't act on the wrong
   *  person. Omitted (read-only) for the simulation, which has no live decision queue. */
  onDecide?: (identity: string, action: "accept" | "reject") => boolean;
  /** Decisions sealed outside the click handler — a reject confirmed in the
   *  rationale dialog (UAT LUC-GEF-L1-08), which lands after `onDecide` has already
   *  returned false. Without it the comparison keeps live buttons over a candidate
   *  who is already rejected. */
  sealed?: Record<string, "accept" | "reject">;
}) {
  const t = useTranslations("decisions.groupEval");
  // eval-speaks-your-language — the persisted eval carries structured facts, not
  // prose; the localize composers turn them into sentences in the reader's
  // language (and pass a legacy payload's stored English through unchanged).
  const tt = t as unknown as Translate;
  const { ranAt, decided, decide, drift, candidates, enriched, skillRows, mustRows, aiBacked } = useGroupEval({
    evaluation,
    createdAt,
    poolDrift,
    onDecide,
    sealed,
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
          <Notices drift={drift} ranAt={ranAt} evaluation={evaluation} governanceMismatch={governanceMismatch} />
          {/* Governance (P1-3): in committee / eligibility-list mode the AI is advisory —
              a banner makes clear it didn't pick or seal a hire. */}
          {governanceText(tt, evaluation) ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
              <Scale size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span>{governanceText(tt, evaluation)}</span>
            </div>
          ) : null}
          <AiVerdict comparison={evaluation.comparison} fallback={summaryText(tt, evaluation)} aiBacked={aiBacked} />
          {evaluation.eligibilityList?.length ? (
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-steel">{t("eligibilityList")}</p>
              <ol className="mt-2 space-y-1">
                {evaluation.eligibilityList.map((c) => (
                  <li key={c.entryId} className="flex items-center gap-2 text-base text-ink">
                    <span className="nums w-6 shrink-0 text-steel">{c.rank}.</span>
                    <span className="font-medium">{c.label}</span>
                    {/* Unscored shows a dash — an eligibility rank must not imply a measured 0. */}
                    <span className="nums text-steel">· {c.score ?? "—"}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-meta text-steel">{t("eligibilityNote")}</p>
            </section>
          ) : null}

          {enriched ? (
            <>
              <ComparisonTable
                candidates={candidates}
                skillRows={skillRows}
                mustRows={mustRows}
                roleBand={evaluation.roleSalaryBand ?? []}
                hasLead={evaluation.topPick != null}
                leadSeparation={evaluation.leadSeparation}
              />
              <FairnessPanel
                fairness={evaluation.fairness ?? null}
                headlineOrder={evaluation.recommendedOrder ?? []}
                robustness={evaluation.robustness}
              />
              <PerCandidateTabs
                candidates={candidates}
                differentiators={evaluation.differentiators ?? []}
                topPick={evaluation.topPick}
                decided={decided}
                onDecide={decide || undefined}
              />
            </>
          ) : (
            <>
              <LegacyView evaluation={evaluation} />
              {/* Surface "robustness could not be assessed" even in the compact view when
                  the ranker failed for a job-backed role (fairness null, matrix expected). */}
              <FairnessPanel
                fairness={evaluation.fairness ?? null}
                headlineOrder={evaluation.recommendedOrder ?? []}
                robustness={evaluation.robustness}
              />
            </>
          )}

          <Risks risks={evaluation.risks ?? []} />
        </div>
      )}
    </Modal>
  );
}
