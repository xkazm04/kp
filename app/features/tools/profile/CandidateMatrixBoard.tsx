"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CandidateChip } from "./CandidateChip";
import { DistributionBar, RetiredFlag } from "./CandidateMatrixShared";
import { groupByArchetype, type ArchetypeColumn } from "./candidateMatrixView";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

// VARIANT A — "Board": the archetype is a LANE, and every lane is on screen at once.
//
// The metaphor is a pin board, not a spreadsheet. Each archetype gets a narrow
// column with its own header (count + cohort shape) and a stack of compact chips
// under it, strongest first — and crucially the lanes WRAP onto the next row rather
// than scrolling sideways, so however many archetypes the registry grows to, the
// board reflows instead of extending off-screen. A lane that runs long scrolls
// inside itself, so one crowded archetype can't push the others down the page.
//
// What it's for: comparison. Lanes side by side answer "where is my pool actually
// concentrated, and how good is each pocket?" in one look — no drill-down, no
// selection, nothing hidden behind a click. That is the direction the Atlas tile-map
// was reaching for, without the click that Atlas made you pay before seeing a
// single name.

export function CandidateMatrixBoard({
  candidates,
  columns,
  onOpen,
  onSave,
}: {
  candidates: CandidateRow[];
  columns: ArchetypeColumn[];
  onOpen: (cand: CandidateRow) => void;
  onSave: (cand: CandidateRow) => void;
}) {
  const t = useTranslations("profile.matrix");
  const enumLabel = useEnumLabel();
  const groups = useMemo(() => groupByArchetype(candidates, columns), [candidates, columns]);
  const labelOf = (g: { id: string; label: string }) => (g.label === g.id ? enumLabel("archetype", g.id) : g.label);

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {groups.map((g) => (
        <li key={g.id} className="flex flex-col rounded-lg border border-stone-200 bg-paper/40">
          <div className="border-b border-stone-200 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-semibold text-ink">{labelOf(g)}</h3>
              <span className="nums text-meta uppercase text-steel">{g.candidates.length}</span>
              {g.archived ? <RetiredFlag /> : null}
            </div>
            <DistributionBar group={g} className="mt-1.5" />
          </div>
          {/* A long lane scrolls inside itself so one crowded archetype cannot set
              the height of the whole board. */}
          <ul className="max-h-[22rem] space-y-1 overflow-y-auto p-1.5">
            {g.candidates.map((cand) => (
              <li key={cand.key}>
                <CandidateChip cand={cand} onOpen={onOpen} onSave={onSave} />
              </li>
            ))}
          </ul>
        </li>
      ))}
      {groups.length === 0 ? (
        <li className="col-span-full rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center text-sm text-steel">
          {t("filteredEmpty")}
        </li>
      ) : null}
    </ul>
  );
}
