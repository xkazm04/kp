"use client";

import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { JdRow, StatusFilter } from "./jdsLibrary";
import { LibraryEmptyStates } from "./JdsEmptyStates";
import type { FilterOption } from "./JdsLedgerFilterMenu";
import { JdsLedgerTableHead } from "./JdsLedgerTableHead";
import { JdsLedgerRow } from "./JdsLedgerRow";

// The table has seven columns; kept in one place so the "no match" row spans them.
const COLS = 7;

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
  reload: () => void;
  duplicating: string | null;
  onOpenRow: (row: JdRow) => void;
  onDuplicate: (row: JdRow) => void;
  onIngested: (slug: string, jobId: string | null) => void;
  onStartGenerate: () => void;
}) {
  const t = useTranslations("library.tab");
  const enumLabel = useEnumLabel();
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
