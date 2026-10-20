import { useTranslations } from "next-intl";
import { Notice } from "@/app/features/hiring/decisions/groupEval/GroupEvalPrimitives";
import { coverageNote } from "@/app/features/hiring/decisions/groupEval/groupEvalSession";
import { disclosureNotes, type DegradedStageName } from "./groupEvalDisclosure";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";
import type { GovernanceCacheMismatch } from "./governanceCacheSync";
import { capNames, type PoolChange } from "./groupEvalDelta";

// next-intl keys are typed, so the mode name cannot be interpolated into a key.
// The map is also the honest shape: the ladder is closed at three modes.
export const MODE_LABEL_KEY = {
  recommendation: "govRecommendation",
  committee: "govCommittee",
  eligibility_list: "govEligibility",
} as const;

// Same reason as MODE_LABEL_KEY: next-intl keys are typed, so a stage name cannot be
// interpolated into one. The map is exhaustive over DegradedStageName, so adding a
// stage to that closed vocabulary is a tsc error here until it has a label.
const DEGRADED_STAGE_KEY: Record<DegradedStageName, "degradedStageRanking" | "degradedStageComparison" | "degradedStageReasoning"> = {
  ranking: "degradedStageRanking",
  comparison: "degradedStageComparison",
  reasoning: "degradedStageReasoning",
};

// Staleness banners above the evaluation: pool drift since the eval ran, the
// "top N of M compared" coverage note for capped runs, and the governance-mode
// mismatch on a cache hit.
export function Notices({
  drift,
  poolChange,
  ranAt,
  evaluation,
  governanceMismatch,
}: {
  drift: number;
  /** WHO joined and left since the evaluation ran (groupEvalDelta.poolChange). Null
   *  when the payload cannot name them: the count sentence then stands alone. */
  poolChange?: PoolChange | null;
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
  // The two honesty disclosures the server records on every saved evaluation — who
  // was withheld for consent, and which AI stages fell back. Both were persisted and
  // neither reached a reader; the rule is pinned in groupEvalDisclosure.test.ts and
  // this component owes only the sentence.
  const disclosure = disclosureNotes(evaluation);
  const names = (list: readonly string[]): string => {
    const { shown, more } = capNames(list);
    return more > 0 ? t("namesAndMore", { names: shown.join(", "), count: more }) : shown.join(", ");
  };
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
        <Notice>
          {t.rich("driftNotice", { count: drift, when: ranAt ? ` (${ranAt})` : "", b: (chunks) => <b>{chunks}</b> })}
          {/* The names decide whether a paid re-run is worth it: a withdrawn
              runner-up and a strong newcomer are different reasons to re-run. */}
          {poolChange?.joined.length ? <> {t("driftJoined", { names: names(poolChange.joined) })}</> : null}
          {poolChange?.left.length ? <> {t("driftLeft", { names: names(poolChange.left) })}</> : null}
        </Notice>
      ) : null}
      {/* Consent/erasure exclusions and AI-stage fallbacks ride in the SAME
          amber Notice the drift and governance warnings use: each is a caveat on
          the comparison below, not a success, so neither may read in a calm or
          confirming tone. Count only for consent — the payload deliberately does
          not carry the excluded people's ids. */}
      {disclosure.consentExcluded !== null ? (
        <Notice>{t("consentExcludedNote", { count: disclosure.consentExcluded })}</Notice>
      ) : null}
      {disclosure.degraded ? (
        <Notice>
          {t(disclosure.degraded.timedOut ? "degradedNoteTimeout" : "degradedNote", {
            stages: disclosure.degraded.stages.map((s) => t(DEGRADED_STAGE_KEY[s])).join(", "),
          })}
        </Notice>
      ) : null}
      {coverage?.kind === "selection" ? (
        <p className="text-sm text-steel">{t("selectionNote", { count: coverage.count, total: coverage.total })}</p>
      ) : coverage?.kind === "capped" ? (
        <p className="text-sm text-steel">{t("capped", { cap: coverage.cap, total: coverage.total })}</p>
      ) : null}
    </>
  );
}
