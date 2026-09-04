"use client";

import { Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { rubricCompare } from "@/app/_lib/devcase-compare";
import type { RubricDim, Submission } from "./DevTypes";

// b268f5e5 — side-by-side candidate compare on the shared rubric axes. The case's
// evaluated submissions are already scored on the SAME dimensions; this lays them
// out as one axis × candidate matrix (top-N by transfer fit) with the per-axis
// leader marked, so a reviewer reads who's strongest on framing vs judgment vs
// architecture without opening every EvalPanel.
export function CompareSubmissions({
  rubricDims,
  submissions,
}: {
  rubricDims: RubricDim[];
  submissions: Submission[];
}) {
  const t = useTranslations("devcase.studio.compare");
  const { axes, columns, leaderByAxis } = rubricCompare(rubricDims, submissions);
  // A comparison needs at least two evaluated candidates and an axis to compare on.
  if (columns.length < 2 || axes.length === 0) return null;

  // rubricCompare CAPS the matrix at its top-N by transfer fit and its contract says
  // "the caller reports the true count" — this one reported `columns.length`, so a
  // nine-candidate cohort rendered as "· 5" with no tell that four were dropped. Two
  // things then read wrong: the count looks like the whole evaluated field, and the
  // moss per-axis leader reads as the cohort's leader when a hidden submission (lower
  // transfer fit, higher on that one axis) actually leads it. Same predicate the lib
  // filters on, so the two counts can't disagree.
  const evaluatedTotal = submissions.filter((s) => s.evaluation?.evaluation).length;
  const hidden = evaluatedTotal - columns.length;
  const truncationNote = hidden > 0 ? t("truncated", { shown: columns.length, hidden }) : null;

  const shortRef = (ref: string | null, i: number) => (ref ? ref.split(/[@\s]/)[0].slice(0, 14) : `#${i + 1}`);

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Columns3 size={13} className="text-coral" /> {t("title")}
        <span className="text-coral">
          · {hidden > 0 ? t("topOf", { shown: columns.length, total: evaluatedTotal }) : columns.length}
        </span>
      </h3>
      {truncationNote ? <p className="mt-1 text-micro text-steel">{truncationNote}</p> : null}
      <div className={`mt-2 overflow-x-auto ${PANEL}`}>
        <table className="w-full text-micro">
          <thead>
            <tr className="border-b border-stone-200 text-steel">
              <th scope="col" className="px-3 py-2 text-left font-semibold uppercase tracking-wide">{t("axis")}</th>
              {columns.map((col, i) => (
                <th key={col.id} scope="col" className="px-3 py-2 text-right font-semibold text-ink">
                  <span className="block truncate">{shortRef(col.candidateRef, i)}</span>
                  <span className="text-micro font-normal text-steel">
                    {t("fit", { score: col.transferScore != null ? col.transferScore : "—" })}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.name} className="border-b border-stone-100 last:border-0">
                <td className="px-3 py-1.5 text-steel">{axis.label}</td>
                {columns.map((col) => {
                  const v = col.scores[axis.name];
                  const isLeader = leaderByAxis[axis.name] === col.id && v != null;
                  return (
                    <td
                      key={col.id}
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        isLeader ? "font-semibold text-moss" : v == null ? "text-stone-300" : "text-ink"
                      }`}
                    >
                      {v == null ? "—" : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
