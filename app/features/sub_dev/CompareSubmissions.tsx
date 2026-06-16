"use client";

import { Columns3 } from "lucide-react";
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
  const { axes, columns, leaderByAxis } = rubricCompare(rubricDims, submissions);
  // A comparison needs at least two evaluated candidates and an axis to compare on.
  if (columns.length < 2 || axes.length === 0) return null;

  const shortRef = (ref: string | null, i: number) => (ref ? ref.split(/[@\s]/)[0].slice(0, 14) : `#${i + 1}`);

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Columns3 size={13} className="text-coral" /> Compare on rubric axes
        <span className="text-coral">· {columns.length}</span>
      </h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
        <table className="w-full text-micro">
          <thead>
            <tr className="border-b border-stone-200 text-steel">
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">Axis</th>
              {columns.map((col, i) => (
                <th key={col.id} className="px-3 py-2 text-right font-semibold text-ink">
                  <span className="block truncate">{shortRef(col.candidateRef, i)}</span>
                  <span className="text-micro font-normal text-steel">
                    fit {col.transferScore != null ? col.transferScore : "—"}
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
