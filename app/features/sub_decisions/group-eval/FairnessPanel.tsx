import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Pill, SectionTitle } from "./primitives";
import type { Fairness, FairnessScheme } from "./types";

// ---- Fairness check (cross-scheme dynamic-weight matrix) -------------------
const fmtScheme = (s: FairnessScheme): string =>
  `S ${Math.round(s.skills * 100)} · C ${Math.round(s.career * 100)} · P ${Math.round(s.personal * 100)}`;

// Renders the fairness matrix: each candidate (row) re-scored under every
// candidate's bounded weighting (column), the mean, the robust order, and the
// per-candidate weight-adjustment notes. When no weighting was actually adjusted
// the matrix is uniform and adds nothing, so we say that plainly instead.
export function FairnessPanel({ fairness, headlineOrder }: { fairness: Fairness | null; headlineOrder: string[] }) {
  const t = useTranslations("decisions.groupEval");
  if (!fairness || !fairness.labels?.length || !fairness.matrix?.length) return null;
  const { labels, schemes, matrix, mean, ranking, weightNotes, candidateIds, weightSource } = fairness;
  const adjusted = candidateIds.some((id) => (weightNotes?.[id]?.length ?? 0) > 0);

  if (!adjusted) {
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
