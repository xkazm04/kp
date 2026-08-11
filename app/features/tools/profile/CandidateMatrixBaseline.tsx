"use client";

// BASELINE — the original archetype × candidate table, extracted verbatim from
// CandidateMatrix.tsx so the prototype switcher can A/B against it unchanged.
//
// Kept as the reference for what the variants are fixing: one column per archetype,
// one row per candidate, and — because every candidate routes to exactly ONE
// archetype — a single filled cell per row with a grey dot everywhere else. At 16
// archetypes × 300 candidates that is 4,800 cells carrying 300 facts, and finding
// anyone means scrolling both axes.

import { useTranslations } from "next-intl";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CandidateMatrixCell } from "./CandidateMatrixCell";
import { RetiredFlag } from "./CandidateMatrixShared";
import type { ArchetypeColumn } from "./candidateMatrixView";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

export function CandidateMatrixBaseline({
  candidates,
  columns,
  onEditProfile,
}: {
  candidates: CandidateRow[];
  columns: ArchetypeColumn[];
  onEditProfile: (id: string) => void;
}) {
  const t = useTranslations("profile.matrix");
  const enumLabel = useEnumLabel();

  // Sort by column order then score desc, so each candidate's single filled cell
  // clusters under its archetype column and reads as a grouped block.
  const order = new Map(columns.map((c, i) => [c.id, i]));
  const rows = [...candidates].sort(
    (a, b) =>
      (order.get(archetypeDisplayKey(a.archetype)) ?? 99) - (order.get(archetypeDisplayKey(b.archetype)) ?? 99) ||
      (b.score ?? -1) - (a.score ?? -1)
  );

  return (
    <div className="animate-arrive-in overflow-x-auto rounded-lg border border-stone-200">
      <table className="min-w-full table-fixed divide-y divide-stone-200">
        <thead className="bg-paper">
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-steel">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {/* Registry columns carry their own label; the synthetic
                      "unrouted"/extra columns (label === id) localize via the enum. */}
                  <span>{c.label === c.id ? enumLabel("archetype", c.id) : c.label}</span>
                  {c.archived ? <RetiredFlag /> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((cand) => (
            <tr key={cand.key} className="align-top">
              {columns.map((c) => (
                <td key={c.id} className="px-3 py-2">
                  {c.id === archetypeDisplayKey(cand.archetype) ? (
                    <CandidateMatrixCell cand={cand} onEditProfile={onEditProfile} />
                  ) : (
                    <span className="text-stone-300">{t("emptyCell")}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
