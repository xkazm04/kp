"use client";

// The saved-profile ledger's table: the filter/sort header row and the rows.
// Split out of ProfileRoster.tsx (which owns the fetch, the filter state and the
// pager) so both stay under the 200-line cap.

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, UserSearch } from "lucide-react";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ProfileRosterRow } from "./ProfileRosterRow";
import type { RosterFacets, RosterFilters, RosterSort, RosterSortCol } from "./profileRosterView";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";

// A column header: the name once, then icon controls for whatever that column can
// do. Naming the column in the label AND again inside each control spelled
// "Candidate ↑ Candidate ▾", which reads as a duplication bug rather than as two
// affordances — so the controls are glyphs and take their accessible names from
// `title` (nothing is lost for AT, only the visual repetition).
function ColumnHead({
  title,
  sortCol,
  sort,
  onSort,
  children,
}: {
  title: string;
  /** Omit for a column with no meaningful order (Status, Archetype…). */
  sortCol?: RosterSortCol;
  sort: RosterSort;
  onSort: (sort: RosterSort) => void;
  /** The column's ColumnFilter, if it has one. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("profile.roster");
  const active = sortCol != null && sort.col === sortCol;
  // Direction is shown only on the ACTIVE column: an idle column showing "↑" claims
  // an ordering it isn't imposing. Idle columns get the neutral two-way glyph.
  const SortIcon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${META_LABEL} ${active ? "text-coral" : ""}`}>{title}</span>
      {sortCol ? (
        <button
          type="button"
          onClick={() => onSort({ col: sortCol, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
          aria-label={t("sortBy", { column: title })}
          title={t("sortBy", { column: title })}
          className={`focus-ring inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
            active ? "bg-coral/10 text-coral" : "text-steel hover:bg-stone-100 hover:text-ink"
          }`}
        >
          <SortIcon size={13} className={active ? "" : "opacity-60"} aria-hidden />
        </button>
      ) : null}
      {children}
    </span>
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
            {/* Name carries both controls: sort, and a search box behind the
                magnifier. Both are glyphs, so the column is named once. */}
            <th scope="col" className="px-3 py-2">
              <ColumnHead title={t("colName")} sortCol="name" sort={sort} onSort={onSort}>
                <ColumnFilter title={t("colName")} mode="search" trigger="icon" value={filters.q} onChange={(q) => onFilters({ q })} />
              </ColumnHead>
            </th>
            <th scope="col" className="px-3 py-2">
              <ColumnHead title={t("colArchetype")} sortCol="archetype" sort={sort} onSort={onSort}>
                <ColumnFilter
                  title={t("colArchetype")}
                  trigger="icon"
                  value={filters.archetype}
                  onChange={(archetype) => onFilters({ archetype })}
                  options={facets.archetypes}
                />
              </ColumnHead>
            </th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">
              <ColumnHead title={t("colFamily")} sortCol="family" sort={sort} onSort={onSort}>
                <ColumnFilter
                  title={t("colFamily")}
                  trigger="icon"
                  value={filters.family}
                  onChange={(family) => onFilters({ family })}
                  options={facets.families}
                />
              </ColumnHead>
            </th>
            <th scope="col" className="px-3 py-2">
              <ColumnHead title={t("colCompleteness")} sortCol="completeness" sort={sort} onSort={onSort} />
            </th>
            <th scope="col" className="px-3 py-2">
              {/* Status has no meaningful order (retired vs. newer-CV is not a
                  ranking), so it filters but does not sort. */}
              <ColumnHead title={t("colStatus")} sort={sort} onSort={onSort}>
                <ColumnFilter
                  title={t("colStatus")}
                  trigger="icon"
                  value={filters.status}
                  onChange={(status) => onFilters({ status })}
                  options={facets.statuses}
                />
              </ColumnHead>
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
