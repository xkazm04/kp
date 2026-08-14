"use client";

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { SortState } from "@/app/_components/table/useTableSort";
import type { JdRow, JdSortCol, StatusFilter } from "./jdsLibrary";
import { LibraryEmptyStates } from "./JdsEmptyStates";
import type { FilterOption } from "./JdsLedgerFilterMenu";
import { JdsLedgerTableHead } from "./JdsLedgerTableHead";
import { JdsLedgerRow } from "./JdsLedgerRow";

// The table's column count; kept in one place so the "no match" / empty / loading
// rows span them all. Bumped 7 → 9 when the per-role Pipeline and Hired columns
// arrived from the Analytics scoreboard prototype.
const COLS = 9;

// The saved-JD table: filterable column headers + rows, plus its own empty/no-
// match/loading states — extracted verbatim from LibrarySavedJdsLedger.tsx so
// that file stays under the 200-line split threshold.
export function JdsLedgerTable({
  rows,
  visible,
  query,
  setQuery,
  searchOpen,
  setSearchOpen,
  field,
  setField,
  fieldOptions,
  seniority,
  setSeniority,
  seniorityOptions,
  status,
  setStatus,
  statusOptions,
  sort,
  onSort,
  reload,
  duplicating,
  onOpenRow,
  onDuplicate,
  onIngested,
  onStartGenerate,
}: {
  rows: JdRow[] | null;
  visible: JdRow[];
  query: string;
  setQuery: (v: string) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  field: string | null;
  setField: (v: string | null) => void;
  fieldOptions: FilterOption[];
  seniority: string | null;
  setSeniority: (v: string | null) => void;
  seniorityOptions: FilterOption[];
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  statusOptions: FilterOption[];
  sort: SortState<JdSortCol>;
  onSort: (col: JdSortCol) => void;
  reload: () => void;
  duplicating: string | null;
  onOpenRow: (row: JdRow) => void;
  onDuplicate: (row: JdRow) => void;
  onIngested: (slug: string, jobId: string | null) => void;
  onStartGenerate: () => void;
}) {
  const t = useTranslations("library.tab");
  const enumLabel = useEnumLabel();
  // The shape bars scale against the busiest role IN THE FULL LIBRARY, not the
  // filtered view: rescaling on every filter change would make the same role's
  // bar jump size for no reason the reader caused, and the comparison it exists
  // to support is between roles, not between filter states.
  const peak = Math.max(1, ...(rows ?? []).map((r) => r.pipeline?.total ?? 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <JdsLedgerTableHead
          query={query}
          setQuery={setQuery}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          field={field}
          setField={setField}
          fieldOptions={fieldOptions}
          seniority={seniority}
          setSeniority={setSeniority}
          seniorityOptions={seniorityOptions}
          status={status}
          setStatus={setStatus}
          statusOptions={statusOptions}
          sort={sort}
          onSort={onSort}
          t={t}
        />
        <tbody className={`divide-y divide-stone-200 ${rows && visible.length > 0 ? "animate-arrive-in" : ""}`}>
          {rows == null ? (
            // Tier 2: nothing fetched yet — hold the rows' height, invisibly
            // at first, so a fast response never flashes a placeholder at all.
            // (Was LedgerSkeleton, a set of pulsing bars drawing a table nobody
            // was getting yet.)
            <tr aria-hidden>
              <td colSpan={COLS} className="p-0">
                <div className="reveal-quiet min-h-[14rem]" />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            // The fetch settled and the library is genuinely empty.
            // /prototype round 2 — the first-run empty library behind a local
            // variant switcher (baseline default). Its CTAs route into the REAL
            // affordance: the Generate panel already mounted beside this table.
            <tr>
              <td colSpan={COLS} className="p-0">
                <LibraryEmptyStates onStartGenerate={onStartGenerate} />
              </td>
            </tr>
          ) : visible.length === 0 ? (
            <tr>
              <td colSpan={COLS} className="px-4 py-10 text-center">
                <p className="text-base font-semibold text-ink">{t("noMatchTitle")}</p>
                <p className="mt-1 text-base text-steel">{query.trim() ? t("noMatchBody", { query: query.trim() }) : t("noMatchFilters")}</p>
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <JdsLedgerRow
                key={row.slug}
                row={row}
                enumLabel={enumLabel}
                reload={reload}
                duplicating={duplicating}
                peak={peak}
                onOpenRow={onOpenRow}
                onDuplicate={onDuplicate}
                onIngested={onIngested}
                t={t}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
