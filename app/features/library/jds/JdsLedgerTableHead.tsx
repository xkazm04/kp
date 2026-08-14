"use client";

import { Search, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import type { SortState } from "@/app/_components/table/useTableSort";
import type { JdSortCol, StatusFilter } from "./jdsLibrary";
import { ColumnHeaderFilter, type FilterOption } from "./JdsLedgerFilterMenu";

// The saved-JD table's column-header row (Role search + Field/Seniority/Status
// filter menus) — extracted verbatim from JdsLedgerTable.tsx so that file stays
// under the 200-line split threshold.
//
// The QUANTITATIVE columns (Pipeline / Analyzed / Saved) use the shared
// table/ColumnHead, so they sort and carry aria-sort. The four categorical ones
// keep their existing bare headers: each already IS a filter trigger, and this
// file's ColumnHeaderFilter has no icon-only mode like the shared ColumnFilter's
// `trigger="icon"` — nesting it under ColumnHead would print the column name
// twice ("Field ⇅ Field ▾"). Filtering is also the more useful verb on a closed
// vocabulary; ordering is what the numbers needed.
export function JdsLedgerTableHead({
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
  t,
}: {
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
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  return (
    <thead>
      <tr className="border-b border-stone-200">
        {/* Role — the search affordance lives here (no separate toolbar). */}
        <th scope="col" className={`${META_LABEL} px-3 py-2.5`}>
          {searchOpen || query ? (
            <div className="relative flex items-center">
              <Search size={14} className="pointer-events-none absolute left-2 text-steel" aria-hidden />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder={t("searchRoles")}
                aria-label={t("searchAria")}
                className="focus-ring h-7 w-44 rounded border border-stone-300 bg-white pl-7 pr-6 text-sm font-normal normal-case tracking-normal text-ink caret-coral placeholder:text-steel"
              />
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                className="focus-ring absolute right-1 rounded p-0.5 text-steel transition-colors hover:text-ink"
                aria-label={t("clearSearch")}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {t("colRole")}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="focus-ring rounded p-0.5 text-steel transition-colors hover:text-ink"
                aria-label={t("searchRoles")}
                title={t("searchRoles")}
              >
                <Search size={13} aria-hidden />
              </button>
            </span>
          )}
        </th>
        <th scope="col" className={`${META_LABEL} px-3 py-2.5`}>
          <ColumnHeaderFilter title={t("colField")} options={fieldOptions} selected={field} onSelect={setField} />
        </th>
        <th scope="col" className={`${META_LABEL} px-3 py-2.5`}>
          <ColumnHeaderFilter title={t("colSeniority")} options={seniorityOptions} selected={seniority} onSelect={setSeniority} />
        </th>
        <th scope="col" className={`${META_LABEL} px-3 py-2.5`}>
          <ColumnHeaderFilter
            title={t("colStatus")}
            options={statusOptions}
            selected={status === "all" ? null : status}
            onSelect={(v) => setStatus((v as StatusFilter) ?? "all")}
          />
        </th>
        {/* The role's live pipeline state, brought here from the Analytics
            scoreboard prototype: this is where a recruiter is already looking at
            their roles, so "how is this one doing" belongs beside "does this JD
            exist" rather than one tab away. */}
        <ColumnHead title={t("colPipeline")} sortCol="pipeline" sort={sort} onSort={onSort} className="whitespace-nowrap px-3 py-2.5" />
        <ColumnHead title={t("colAnalyzed")} sortCol="analyzed" sort={sort} onSort={onSort} align="right" className="whitespace-nowrap px-3 py-2.5" />
        <ColumnHead title={t("colSaved")} sortCol="saved" sort={sort} onSort={onSort} className="whitespace-nowrap px-3 py-2.5" />
        <th scope="col" className={`${META_LABEL} px-3 py-2.5 text-right`}>{t("colActions")}</th>
      </tr>
    </thead>
  );
}
