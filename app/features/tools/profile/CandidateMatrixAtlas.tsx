"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CandidateMatrixCell } from "./CandidateMatrixCell";
import { DistributionBar, RetiredFlag } from "./CandidateMatrixShared";
import { groupByArchetype, largestGroupId, type ArchetypeColumn } from "./candidateMatrixView";
import type { CandidateRow } from "@/app/features/shared/profileTypes";

// VARIANT A — "Atlas": the taxonomy is a MAP, and candidates are what you get when
// you land on a territory.
//
// The metaphor: you don't read a map by scrolling it, you read it whole and then
// zoom. So the archetypes render as a WRAPPING tile grid — no horizontal axis at
// all, the entire taxonomy visible in one eyeful however many archetypes exist —
// and each tile carries the two facts that let you choose without opening it: how
// many candidates routed here, and what shape that cohort is (the distribution
// bar). Only the selected territory expands into candidate cards below.
//
// What it fixes vs. the baseline table: the baseline spends a full column on every
// archetype and a full row on every candidate, so orienting means scrolling x AND
// y past a grid that is ~94% empty dots. Here the overview is O(archetypes) tiles
// that WRAP, and the detail is O(one group) cards — neither ever needs a
// horizontal scrollbar, and "which archetype is my pool actually in?" is answered
// before a single click.

export function CandidateMatrixAtlas({
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
  const groups = useMemo(() => groupByArchetype(candidates, columns), [candidates, columns]);
  // Open on the biggest cohort so the first screen is a map AND a real group,
  // never an empty "pick something above" panel. Derived-with-override rather than
  // an effect: a data refetch that removes the selected archetype falls back on
  // its own, with no state to resync.
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = groups.some((g) => g.id === picked) ? picked : largestGroupId(groups);
  const selected = groups.find((g) => g.id === selectedId) ?? null;

  // Registry columns carry their own label; the synthetic "unrouted"/extra columns
  // (label === id) localize through the enum catalog.
  const labelOf = (g: { id: string; label: string }) => (g.label === g.id ? enumLabel("archetype", g.id) : g.label);

  return (
    <div className="space-y-4">
      {/* THE MAP — wraps, never scrolls sideways. */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {groups.map((g) => {
          const isActive = g.id === selectedId;
          return (
            <li key={g.id}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => setPicked(g.id)}
                className={`focus-ring flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                  isActive
                    ? "border-coral bg-coral/5"
                    : "border-stone-200 bg-white hover:border-coral/40 hover:bg-paper/60"
                }`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-semibold ${isActive ? "text-coral" : "text-ink"}`}>{labelOf(g)}</span>
                  <span className="nums shrink-0 font-serif text-h2 leading-none text-ink">{g.candidates.length}</span>
                </span>
                {g.archived ? <RetiredFlag /> : null}
                <DistributionBar group={g} className="mt-auto" />
              </button>
            </li>
          );
        })}
      </ul>

      {/* THE TERRITORY — only the selected archetype's candidates. */}
      {selected ? (
        <section className="rounded-lg border border-stone-200 bg-paper/40 p-3" aria-live="polite">
          <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {labelOf(selected)}
            <span className="text-meta uppercase text-steel">
              {t("groupCount", { count: selected.candidates.length })}
            </span>
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {selected.candidates.map((cand) => (
              <li key={cand.key}>
                <CandidateMatrixCell cand={cand} onEditProfile={onEditProfile} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
