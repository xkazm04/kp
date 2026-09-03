import { useTranslations } from "next-intl";
import { Notice } from "@/app/features/hiring/decisions/groupEval/GroupEvalPrimitives";
import { coverageNote } from "@/app/features/hiring/decisions/groupEval/groupEvalSession";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import type { GovernanceCacheMismatch } from "./governanceCacheSync";

// next-intl keys are typed, so the mode name cannot be interpolated into a key.
// The map is also the honest shape: the ladder is closed at three modes.
const MODE_LABEL_KEY = {
  recommendation: "govRecommendation",
  committee: "govCommittee",
  eligibility_list: "govEligibility",
} as const;

// Staleness banners above the evaluation: pool drift since the eval ran, the
// "top N of M compared" coverage note for capped runs, and the governance-mode
// mismatch on a cache hit.
export function Notices({
  drift,
  ranAt,
  evaluation,
  governanceMismatch,
}: {
  drift: number;
  ranAt: string | null;
  evaluation: GroupEvalPayload;
  /** Set when this SAVED evaluation was produced under a different governance mode
   *  than the control now shows. Reading a recommendation-mode comparison while the
   *  control says "committee" is exactly the confusion the notice exists to end. */
  governanceMismatch?: GovernanceCacheMismatch | null;
}) {
  const t = useTranslations("decisions.groupEval");
  // The mode NAMES come from the governance control's own keys, so the notice can
  // never call a mode something different from the selector the recruiter just used.
  const tDecisions = useTranslations("decisions");
  // group-eval-cohort-choice — an explicit selection discloses "your selection of N
  // of M"; the default top-N run discloses the capped coverage. Mutually exclusive,
  // and the rule is now a pinned function rather than a JSX ternary.
  const coverage = coverageNote(evaluation);
  return (
    <>
      {governanceMismatch ? (
        <Notice>
          {t.rich(governanceMismatch.weaker ? "governanceMismatchWeaker" : "governanceMismatch", {
            ranUnder: tDecisions(MODE_LABEL_KEY[governanceMismatch.ranUnder]),
            selected: tDecisions(MODE_LABEL_KEY[governanceMismatch.selected]),
            b: (chunks) => <b>{chunks}</b>,
          })}
        </Notice>
      ) : null}
      {drift > 0 ? (
        <Notice>{t.rich("driftNotice", { count: drift, when: ranAt ? ` (${ranAt})` : "", b: (chunks) => <b>{chunks}</b> })}</Notice>
      ) : null}
      {coverage?.kind === "selection" ? (
        <p className="text-sm text-steel">{t("selectionNote", { count: coverage.count, total: coverage.total })}</p>
      ) : coverage?.kind === "capped" ? (
        <p className="text-sm text-steel">{t("capped", { cap: coverage.cap, total: coverage.total })}</p>
      ) : null}
    </>
  );
}
