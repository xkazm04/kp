"use client";

// The saved-profile ledger's table: the filter/sort header row and the rows.
// Split out of ProfileRoster.tsx (which owns the fetch, the filter state and the
// pager) so both stay under the 200-line cap.

import { useTranslations } from "next-intl";
import { UserSearch } from "lucide-react";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ProfileRosterRow } from "./ProfileRosterRow";
import type { RosterFacets, RosterFilters, RosterSort, RosterSortCol } from "./profileRosterView";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";

// The local ColumnHead this file used to carry is now the shared
// app/_components/table/ColumnHead — same glyph-only controls (naming the column
// in the label AND again inside each control spelled "Candidate ↑ Candidate ▾",
// which reads as a duplication bug rather than as two affordances), and it
// additionally renders the `<th>` so `aria-sort` is set. This copy never was, so
// a screen-reader user could operate the sort and never learn the table was
// sorted at all.

export function ProfileRosterTable({
  shown,
  loading,
  emptyFiltered,
  onClearFilters,
  filters,
  onFilters,
  facets,
  sort,
  onSort,
  stale,
  archivedSet,
  confirmingId,
  busyId,
  onEdit,
  onMatch,
  onRebuild,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  shown: RosterProfile[];
  /** The first /api/profile read is still in flight: the header row and its filters
   *  are real and usable, the body holds a quiet reserved height instead of rows. */
  loading: boolean;
  /** Filters cut a non-empty roster to zero rows. */
  emptyFiltered: boolean;
  onClearFilters: () => void;
  filters: RosterFilters;
  onFilters: (patch: Partial<RosterFilters>) => void;
  facets: RosterFacets;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
  stale: StaleMap;
  archivedSet: ReadonlySet<string>;
  confirmingId: string | null;
  busyId: string | null;
  onEdit: (id: string) => void;
  onMatch: (id: string) => void;
  onRebuild: (id: string, newerSlug: string) => void;
  onStartDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}) {
  const t = useTranslations("profile.roster");
  // The shared ColumnHead reports the clicked COLUMN; this roster's owner state
  // is a full {col, dir}. Toggle semantics kept byte-identical to the local
  // header this replaced — a new column starts ascending — so promoting the
  // component changes accessibility (aria-sort) and nothing the reader does.
  const toggleSort = (col: RosterSortCol) =>
    onSort({ col, dir: sort.col === col && sort.dir === "asc" ? "desc" : "asc" });

  if (emptyFiltered) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
        <UserSearch size={22} className="text-steel" aria-hidden />
        <p className="text-sm text-steel">{t("filteredEmpty")}</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="focus-ring rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
        >
          {t("clearFilters")}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full min-w-[44rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60">
            {/* Name carries both controls: sort, and a search box behind the
                magnifier. Both are glyphs, so the column is named once. */}
            <ColumnHead title={t("colName")} sortCol="name" sort={sort} onSort={toggleSort} className="px-3 py-2">
              <ColumnFilter title={t("colName")} mode="search" trigger="icon" value={filters.q} onChange={(q) => onFilters({ q })} />
            </ColumnHead>
            <ColumnHead title={t("colArchetype")} sortCol="archetype" sort={sort} onSort={toggleSort} className="px-3 py-2">
              <ColumnFilter
                title={t("colArchetype")}
                trigger="icon"
                value={filters.archetype}
                onChange={(archetype) => onFilters({ archetype })}
                options={facets.archetypes}
              />
            </ColumnHead>
            <ColumnHead title={t("colFamily")} sortCol="family" sort={sort} onSort={toggleSort} className="hidden px-3 py-2 md:table-cell">
              <ColumnFilter
                title={t("colFamily")}
                trigger="icon"
                value={filters.family}
                onChange={(family) => onFilters({ family })}
                options={facets.families}
              />
            </ColumnHead>
            <ColumnHead title={t("colCompleteness")} sortCol="completeness" sort={sort} onSort={toggleSort} className="px-3 py-2" />
            {/* Status has no meaningful order (retired vs. newer-CV is not a
                ranking), so it filters but does not sort. */}
            <ColumnHead title={t("colStatus")} sort={sort} onSort={toggleSort} className="px-3 py-2">
              <ColumnFilter
                title={t("colStatus")}
                trigger="icon"
                value={filters.status}
                onChange={(status) => onFilters({ status })}
                options={facets.statuses}
              />
            </ColumnHead>
            <th scope="col" className={`px-3 py-2 text-right ${META_LABEL}`}>
              <span className="sr-only">{t("colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // Tier 2 (docs/design/loading-choreography.md): hold roughly a page of
            // rows' height and stay invisible for 150ms, so a warm response paints
            // no placeholder at all.
            <tr aria-hidden>
              <td colSpan={6} className="p-0">
                <div className="reveal-quiet min-h-[18rem]" />
              </td>
            </tr>
          ) : null}
          {shown.map((p) => (
            <ProfileRosterRow
              key={p.id}
              p={p}
              staleInfo={stale[p.id]}
              isArchivedArchetype={Boolean(p.archetype && archivedSet.has(p.archetype))}
              confirming={confirmingId === p.id}
              busy={busyId === p.id}
              onEdit={onEdit}
              onMatch={onMatch}
              onRebuild={onRebuild}
              onStartDelete={onStartDelete}
              onCancelDelete={onCancelDelete}
              onConfirmDelete={onConfirmDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
