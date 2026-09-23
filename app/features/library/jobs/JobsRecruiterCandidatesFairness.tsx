"use client";

import { memo, useMemo } from "react";
import { Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { NOTICE } from "@/app/_components/ui/recipes";
import type { FairnessMatrix } from "./JobsTypes";

// The KO-filtered cohort no longer has a section of its own here. Each of the
// three Candidates layouts carries it in the shape that layout can be honest in
// (rows in the Ladder's table, a collapsed band in Rungs, a collapsed list under
// the Grid), with the per-candidate KO reasons and the near-miss flag that made
// the old shared <details> worth having. What remains in this file is the one
// piece no layout owns: the cross-scheme audit.

// e1e4e0ea — the auditable cross-scheme view: every candidate's own vs robust
// (mean-across-all-schemes) score + delta, sorted by robustness, with a CSV export
// of the full per-scheme matrix. The bias-defensible artifact a compliance review asks for.
// MEMO BOUNDARY. The heaviest derivation on the surface — a map over every
// candidate plus a full sort — and it was executed in the render body on every
// parent render, collapsed or not.
export const FairnessAuditPanel = memo(function FairnessAuditPanel({
  fairness,
  fairById,
  poolTruncated,
  onExport,
}: {
  fairness: FairnessMatrix;
  fairById: Map<string, { own: number; mean: number; delta: number }>;
  /** The route's cap flag. The amber note lives ~30 lines above this collapsed
   *  panel, so a reviewer who opens the audit reads a ranking over a subset with
   *  nothing beside it saying so — the caveat is repeated INSIDE the artifact. */
  poolTruncated: boolean;
  onExport: () => void;
}) {
  const t = useTranslations("jobs.candidates");
  const rows = useMemo(() => {
    const ids = fairness.candidateIds ?? fairness.labels.map((_, i) => String(i));
    return ids
      .map((cid, i) => ({
        // Row identity is the candidate id: two candidates can share a display name.
        id: cid,
        label: fairness.labels[i] ?? cid,
        ...(fairById.get(cid) ?? {
          own: fairness.own[i] ?? 0,
          mean: fairness.mean[i] ?? 0,
          delta: (fairness.mean[i] ?? 0) - (fairness.own[i] ?? 0),
        }),
      }))
      .sort((a, b) => b.mean - a.mean);
  }, [fairness, fairById]);
  return (
    <details className="mt-3 rounded-md border border-stone-200 bg-paper/40 px-3 py-2">
      <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-steel hover:text-ink">
        <Scale size={13} className="text-coral" /> {t("fairnessAudit")}
      </summary>
      <p className="mt-2 text-sm text-steel">{t("fairnessAuditHelp")}</p>
      {poolTruncated ? (
        <p role="note" className={`${NOTICE("amber")} mt-2 px-2.5 py-1.5 text-sm`}>{t("auditPoolTruncated")}</p>
      ) : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel">
              <th scope="col" className="py-1 pr-3 font-semibold">{t("auditCandidate")}</th>
              <th scope="col" className="py-1 pr-3 font-semibold">{t("auditOwn")}</th>
              <th scope="col" className="py-1 pr-3 font-semibold">{t("auditRobust")}</th>
              <th scope="col" className="py-1 font-semibold">{t("auditDelta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="py-1 pr-3 text-ink">{r.label}</td>
                <td className="nums py-1 pr-3 text-steel">{r.own}</td>
                <td className="nums py-1 pr-3 font-semibold text-ink">{r.mean}</td>
                <td className={`nums py-1 font-semibold ${r.delta >= 0 ? "text-moss" : "text-amber-700"}`}>
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onExport}
        className="focus-ring mt-2 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/50"
      >
        {t("fairnessAuditExport")}
      </button>
    </details>
  );
});
