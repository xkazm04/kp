"use client";

// The saved-profile ledger's table: the filter/sort header row and the rows.
// Split out of ProfileRoster.tsx (which owns the fetch, the filter state and the
// pager) so both stay under the 200-line cap.

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, UserSearch } from "lucide-react";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ProfileRosterRow } from "./ProfileRosterRow";
import type { RosterFacets, RosterFilters, RosterSort, RosterSortCol } from "./profileRosterView";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";

// A header that sorts its column. Clicking the active column flips direction, so
// "least complete first" is one extra click rather than a second control — and the
// arrow says which way it currently reads instead of leaving the reader to infer it
// from the rows.
function SortHeader({
  col,
  title,
  sort,
  onSort,
}: {
  col: RosterSortCol;
  title: string;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
}) {
  const active = sort.col === col;
  const Arrow = active && sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort({ col, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 ${META_LABEL} ${
        active ? "text-coral" : "hover:text-ink"
      }`}
    >
      {title}
      <Arrow size={12} className={active ? "" : "opacity-30"} aria-hidden />
    </button>
  );
}

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
            {/* Name is both the sort key and the search box: the header carries the
                sort, the filter chevron beside it opens the search. */}
            <th scope="col" className="px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                <SortHeader col="name" title={t("colName")} sort={sort} onSort={onSort} />
                <ColumnFilter
                  title={t("colName")}
                  mode="search"
                  value={filters.q}
                  onChange={(q) => onFilters({ q })}
                />
              </span>
            </th>
            <th scope="col" className="px-3 py-2">
              <ColumnFilter
                title={t("colArchetype")}
                value={filters.archetype}
                onChange={(archetype) => onFilters({ archetype })}
                options={facets.archetypes}
              />
            </th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">
              <ColumnFilter
                title={t("colFamily")}
                value={filters.family}
                onChange={(family) => onFilters({ family })}
                options={facets.families}
              />
            </th>
            <th scope="col" className="px-3 py-2">
              <SortHeader col="completeness" title={t("colCompleteness")} sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="px-3 py-2">
              <ColumnFilter
                title={t("colStatus")}
                value={filters.status}
                onChange={(status) => onFilters({ status })}
                options={facets.statuses}
              />
            </th>
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
