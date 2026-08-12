"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ProfileEmptyState } from "./ProfileEmptyStates";
import { CandidateDetailModal } from "./CandidateDetailModal";
import { CandidateMatrixBoard } from "./CandidateMatrixBoard";
import { CandidateMatrixFilterBar } from "./CandidateMatrixFilterBar";
import {
  archetypeColumns,
  candidateFacets,
  filterCandidates,
  hasActiveFilters,
  NO_CANDIDATE_FILTERS,
  type CandidateFilters,
} from "./candidateMatrixView";
import type { ArchetypeDef, CandidateRow } from "@/app/features/shared/profileTypes";

// The Matrix projection of the Archetypes tab: the candidate population as a BOARD
// of archetype lanes. Owns the fetch, the population filters, the detail modal and
// the panel chrome; CandidateMatrixBoard is pure presentation over (candidates,
// columns).
//
// This is the consolidated winner of a two-round `/prototype` run, and what it beat
// is worth keeping written down, because each loss was a specific lesson:
//   · Table (the original) — an archetype × candidate grid. Every candidate routes
//     to exactly ONE archetype, so ~94% of its cells were grey dots and finding
//     anyone meant scrolling both axes.
//   · Atlas — a tile map of the taxonomy that expanded one archetype at a time. It
//     read well but charged a click before showing a single name.
//   · Deck — one dense ranked grid with archetype demoted to a tag. Denser, but it
//     threw away the per-archetype cohort shape that answers "where is my pool
//     actually concentrated".
//   · Ledger — one column with sticky archetype sections. Fine, but strictly less
//     visible at once than lanes for the same scroll.
// Board keeps every archetype on screen (lanes WRAP rather than scrolling sideways)
// and gives each one a distribution bar, so the comparison the others lost is the
// thing you see first.

export function CandidateMatrix({
  archetypes,
  onEditProfile,
  onNewProfile,
  reloadKey = 0,
  archivedArchetypeIds,
}: {
  archetypes: ArchetypeDef[];
  /** Open the editor for a saved profile (same ?edit= flow the roster uses). */
  onEditProfile: (id: string) => void;
  /** Create CTA for the EMPTY state only — the always-on create button lives next
   *  to the projection toggle on ProfileTab, reachable from List and Matrix alike. */
  onNewProfile?: () => void;
  /** Bump to force a refetch (e.g. after a roster delete elsewhere on the tab). */
  reloadKey?: number;
  /** Ids of retired archetypes — a retired group with candidates is flagged; an
   *  EMPTY retired group is pruned (no dead all-dots column). */
  archivedArchetypeIds?: readonly string[];
}) {
  const t = useTranslations("profile.matrix");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CandidateFilters>(NO_CANDIDATE_FILTERS);
  const [detail, setDetail] = useState<CandidateRow | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile/candidates")
      .then((r) => r.json())
      .then((p) => {
        if (!alive) return;
        if (p.error) {
          setError(p.error);
        } else {
          // Clear any prior error in the continuation (not synchronously in the
          // effect body) so a successful refetch after a transient failure recovers.
          setError(null);
          setCandidates((p.candidates as CandidateRow[]) ?? []);
        }
      })
      .catch(() => {
        if (alive) setError(t("loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [t, reloadKey]);

  const all = useMemo(() => candidates ?? [], [candidates]);
  const shown = useMemo(() => filterCandidates(all, filters), [all, filters]);
  // Columns derive from the FILTERED set so an archetype nobody in view routed to
  // doesn't linger as an empty lane.
  const columns = useMemo(
    () => archetypeColumns(archetypes, shown, archivedArchetypeIds ?? []),
    [archetypes, shown, archivedArchetypeIds]
  );
  const facets = useMemo(
    () => candidateFacets(all, { locale, label: (group, slug) => enumLabel(group, slug) }),
    [all, locale, enumLabel]
  );

  const patchFilters = useCallback((patch: Partial<CandidateFilters>) => setFilters((f) => ({ ...f, ...patch })), []);
  // Promote an analysed CV into a saved, matchable profile — prefilled and STAMPED
  // with source lineage (?fromAnalysis=), so a later re-analysis of the same CV
  // surfaces as staleness on the profile.
  const buildFromAnalysis = useCallback(
    (slug: string) => router.push(buildUrl({ tab: "archetypes", fromAnalysis: slug }, "")),
    [router]
  );
  // The chip's single action icon: edit a saved profile, or save an analysis as one.
  const onSave = useCallback(
    (cand: CandidateRow) => {
      if (cand.source === "profile") {
        if (cand.id) onEditProfile(cand.id);
      } else if (cand.slug) {
        buildFromAnalysis(cand.slug);
      }
    },
    [onEditProfile, buildFromAnalysis]
  );

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      {/* The "Build candidate profile" CTA lives on ProfileTab beside the projection
          toggle — shared by both projections, so no button here. */}
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-4 space-y-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : candidates == null ? (
          // Tier 2 (docs/design/loading-choreography.md): first fetch in flight — hold the
          // matrix's height, invisible for 150ms. `reloadKey` bumps re-run the effect but
          // never reset `candidates` to null, so a refetch settles silently behind
          // whatever is already on screen.
          <div className="h-32 reveal-quiet" aria-hidden />
        ) : all.length === 0 ? (
          <ProfileEmptyState view="matrix" archetypes={archetypes} onNewProfile={onNewProfile} />
        ) : (
          <>
            <CandidateMatrixFilterBar
              filters={filters}
              onFilters={patchFilters}
              families={facets.families}
              seniorities={facets.seniorities}
              shown={shown.length}
              total={all.length}
              // Whether a filter is SET, not whether it changed the count: filtering
              // to `source=analysis` in a pool that is all analyses narrows nothing,
              // and hiding the Clear button there would leave an active filter with
              // no visible way to undo it.
              filtered={hasActiveFilters(filters)}
              onClear={() => setFilters(NO_CANDIDATE_FILTERS)}
            />
            <CandidateMatrixBoard candidates={shown} columns={columns} onOpen={setDetail} onSave={onSave} />
          </>
        )}
      </div>

      {detail ? (
        <CandidateDetailModal
          cand={detail}
          onClose={() => setDetail(null)}
          onEditProfile={onEditProfile}
          onBuildFromAnalysis={buildFromAnalysis}
        />
      ) : null}
    </section>
  );
}
