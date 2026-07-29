import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Pill, SectionTitle } from "@/app/features/hiring/decisions/groupEval/GroupEvalPrimitives";
import { isFairnessAligned } from "@/app/features/shared/groupEvalTypes";
import type { Fairness, FairnessScheme, RobustnessStatus } from "@/app/features/shared/groupEvalTypes";

// ---- Fairness check (cross-scheme dynamic-weight matrix) -------------------
const fmtScheme = (s: FairnessScheme): string =>
  `S ${Math.round(s.skills * 100)} · C ${Math.round(s.career * 100)} · P ${Math.round(s.personal * 100)}`;

// Renders the fairness matrix: each candidate (row) re-scored under every
// candidate's bounded weighting (column), the mean, the robust order, and the
// per-candidate weight-adjustment notes. The check only proves something when the
// weights actually vary, so the degenerate states report the TRUTH instead of a false
// pass (bug-ui-scan-2026-07-09): uniform weights → "not tested" (a no-op), and a
// ranker that produced no matrix on a job-backed role → an explicit "could not assess"
// panel rather than silently vanishing.
export function FairnessPanel({
  fairness,
  headlineOrder,
  robustness,
}: {
  fairness: Fairness | null;
  headlineOrder: string[];
  robustness?: RobustnessStatus;
}) {
  const t = useTranslations("decisions.groupEval");
  if (robustness === "insufficient_sample") {
    // Single-candidate field (bug-ui-scan-2026-07-09 #4): there is no field to re-rank, so
    // there is no robustness to claim and no lead was crowned. Say so explicitly rather
    // than rendering a trivially-"robust" length-1 matrix.
    return (
      <section>
        <SectionTitle>{t("fairnessCheck")}</SectionTitle>
        <p className="mt-1 text-base text-amber-700">{t("fairnessInsufficient")}</p>
        <p className="mt-1 text-sm text-steel">{t("fairnessScopeNote")}</p>
      </section>
    );
  }
  if (!isFairnessAligned(fairness)) {
    // The role had a job (a matrix was expected) but the ranker produced no USABLE
    // fairness data — surface "could not assess" explicitly so a sealed lead never
    // reads as robustness-checked. A job-less role (not_applicable) or a legacy payload
    // with no robustness signal renders nothing rather than a false claim.
    //
    // "usable" now means the parallel arrays genuinely align (isFairnessAligned), not
    // merely that labels/matrix are non-empty: this component indexes schemes[j],
    // matrix[i][j] and mean[i] in lockstep, so a persisted blob whose arrays disagree
    // used to throw and unmount the ENTIRE modal (comparison, decide buttons, and the
    // Re-run that would have replaced the bad blob) on every reopen. A present-but-
    // misaligned blob is a check that could not be assessed, so it degrades into this
    // branch regardless of the persisted `robustness` value — that value was derived
    // from the same broken data.
    if (robustness === "unavailable" || fairness) {
      return (
        <section>
          <SectionTitle>{t("fairnessCheck")}</SectionTitle>
          <p className="mt-1 text-base text-amber-700">{t("unavailable")}</p>
          <p className="mt-1 text-sm text-steel">{t("fairnessScopeNote")}</p>
        </section>
      );
    }
    return null;
  }
  const { labels, schemes, matrix, mean, ranking, weightNotes, candidateIds, weightSource } = fairness;
  const adjusted = candidateIds.some((id) => (weightNotes?.[id]?.length ?? 0) > 0);

  if (!adjusted) {
    // Uniform weights: every scheme is identical, so "order unchanged" is guaranteed a
    // priori — the cross-scheme test never actually varied anything. Say "not tested",
    // NOT "robust" (fairnessUniform copy reworded to drop the false PASS).
    return (
      <section>
        <SectionTitle>{t("fairnessCheck")}</SectionTitle>
        <p className="mt-1 text-base text-steel">{t("fairnessUniform")}</p>
        <p className="mt-1 text-sm text-steel">{t("fairnessScopeNote")}</p>
      </section>
    );
  }

  const diverges = ranking.length === headlineOrder.length && ranking.some((l, i) => l !== headlineOrder[i]);

  return (
    <section>
      <div className="flex items-center gap-2">
        <SectionTitle>{t("fairnessCheck")}</SectionTitle>
        <Pill tone={weightSource === "llm" ? "info" : "neutral"}>
          {weightSource === "llm" ? t("aiTunedWeights") : t("ruleBasedWeights")}
        </Pill>
      </div>
      <p className="mt-1 text-base text-steel">
        {t.rich("fairnessExplain", { em: (chunks) => <em>{chunks}</em> })}
      </p>
      <p className="mt-1 text-sm text-steel">{t("fairnessScopeNote")}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {/* a11y (bug-ui-scan-2026-07-09 #5): a visually-hidden caption names the grid
              for assistive tech, and every header carries an explicit scope so a cell's
              number is associated with its row + column candidate. */}
          <caption className="sr-only">{t("fairnessMatrixCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("scoredCandidate")}</th>
              {labels.map((l, j) => (
                <th key={candidateIds[j] ?? j} scope="col" className="min-w-[120px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">{t("underLabel", { label: l })}</p>
                  <p className="text-meta text-steel nums">{fmtScheme(schemes[j])}</p>
                </th>
              ))}
              <th scope="col" className="p-2 text-left text-meta uppercase text-steel">{t("mean")}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={candidateIds[i] ?? i} className="border-t border-stone-100">
                <th scope="row" className="sticky left-0 bg-white p-2 text-left font-medium text-ink">{l}</th>
                {labels.map((other, j) => (
                  <td key={candidateIds[j] ?? j} className="p-2">
                    {/* The "own weighting" diagonal is signalled by a non-colour cue (a
                        dotted underline, visible in greyscale) AND an sr-only label — not
                        colour alone (bug-ui-scan-2026-07-09 #5). */}
                    <span
                      className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${
                        i === j
                          ? "bg-coral/10 text-coral ring-1 ring-coral/30 underline decoration-dotted decoration-2 underline-offset-2"
                          : "bg-stone-100 text-ink"
                      }`}
                      title={i === j ? t("ownWeighting") : t("crossWeighting", { label: l, other })}
                    >
                      {matrix[i][j]}
                      {i === j ? <span className="sr-only"> ({t("ownWeighting")})</span> : null}
                    </span>
                  </td>
                ))}
                <td className="p-2 font-semibold text-ink nums">{mean[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase text-steel">{t("robustOrder")}</span>
        {ranking.map((l, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 ? <ArrowRight size={12} className="text-steel" aria-hidden /> : null}
            <Pill tone={i === 0 ? "moss" : "neutral"}>{l}</Pill>
          </span>
        ))}
      </div>
      <p className={`mt-1.5 text-sm ${diverges ? "text-amber-700" : "text-steel"}`}>
        {diverges ? t("robustDiverges") : t("robustAgrees")}
      </p>

      <ul className="mt-2 space-y-1">
        {candidateIds.map((id, i) =>
          (weightNotes?.[id]?.length ?? 0) > 0 ? (
            <li key={id} className="text-sm text-ink">
              <span className="font-medium">{labels[i]}:</span>{" "}
              <span className="text-steel">{weightNotes[id].join("; ")}</span>
            </li>
          ) : null
        )}
      </ul>
    </section>
  );
}
