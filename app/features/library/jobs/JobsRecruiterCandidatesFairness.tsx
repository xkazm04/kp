"use client";

import { memo, useMemo } from "react";
import { Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { ARCHETYPE_BADGE } from "./JobsTypes";
import type { CandRow, FairnessMatrix } from "./JobsTypes";

// JOB4 — the ranker has always shipped per-candidate KO reasons for the
// not-eligible cohort; this UI reduced them to a bare count, so "12 not
// eligible" couldn't tell a recruiter whether the pool lacks German or is one
// year short. Collapsed disclosure, near-misses (a single KO reason) first —
// they're the candidates a relaxed must-have on the JD might rescue. Reason
// strings are the engine's candidate-facing detail clauses, shown verbatim.
// MEMO BOUNDARY. A sort over the entire KO cohort, run in the render body of a
// component whose parent re-renders on every add/reach/toggle — for a <details>
// that is collapsed most of the time.
export const NotEligibleSection = memo(function NotEligibleSection({ rows }: { rows: CandRow[] }) {
  const t = useTranslations("jobs.candidates");
  // Near-misses (a single KO reason) first — they're the candidates a relaxed
  // must-have might rescue. Hooks run before the early return, per the rules of hooks.
  const sorted = useMemo(() => [...rows].sort((a, b) => a.koReasons.length - b.koReasons.length), [rows]);
  if (rows.length === 0) return null;
  return (
    <details className="mt-3 rounded-md border border-stone-200 bg-paper/50 px-3 py-2">
      <summary className="focus-ring cursor-pointer text-sm font-semibold text-steel hover:text-ink">
        {t("notEligibleWhy", { count: rows.length })}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {sorted.map((c) => (
          <li key={c.candidateId} className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="font-medium text-ink">{c.label}</span>
            <span className="rounded-full bg-ink/90 px-1.5 py-0.5 text-meta text-white">
              {ARCHETYPE_BADGE[c.archetype] ?? c.archetype}
            </span>
            {c.koReasons.length === 1 ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-meta text-amber-800">
                {t("nearMiss")}
              </span>
            ) : null}
            <span className="text-steel">{c.koReasons.join("; ")}</span>
          </li>
        ))}
      </ul>
    </details>
  );
});

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
        <p role="note" className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-sm text-amber-800">
          {t("auditPoolTruncated")}
        </p>
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
              <tr key={r.label} className="border-t border-stone-100">
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
