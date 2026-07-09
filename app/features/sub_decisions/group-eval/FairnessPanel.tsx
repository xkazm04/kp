import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Pill, SectionTitle } from "./primitives";
import type { Fairness, FairnessScheme, RobustnessStatus } from "./types";

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
  if (!fairness || !fairness.labels?.length || !fairness.matrix?.length) {
    // The role had a job (a matrix was expected) but the ranker produced no fairness
    // data — surface "could not assess" explicitly so a sealed lead never reads as
    // robustness-checked. A job-less role (not_applicable) or a legacy payload with no
    // robustness signal renders nothing rather than a false claim.
    if (robustness === "unavailable") {
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
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("scoredCandidate")}</th>
              {labels.map((l, j) => (
                <th key={j} className="min-w-[120px] p-2 text-left align-bottom">
                  <p className="font-medium text-ink">{t("underLabel", { label: l })}</p>
                  <p className="text-meta text-steel nums">{fmtScheme(schemes[j])}</p>
                </th>
              ))}
              <th className="p-2 text-left text-meta uppercase text-steel">{t("mean")}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="sticky left-0 bg-white p-2 font-medium text-ink">{l}</td>
                {labels.map((other, j) => (
                  <td key={j} className="p-2">
                    <span
                      className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${
                        i === j ? "bg-coral/10 text-coral ring-1 ring-coral/30" : "bg-stone-100 text-ink"
                      }`}
                      title={i === j ? t("ownWeighting") : t("crossWeighting", { label: l, other })}
                    >
                      {matrix[i][j]}
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
