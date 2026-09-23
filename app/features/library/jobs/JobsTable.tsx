"use client";

import { useTranslations } from "next-intl";
import { ColumnFilter, type Option } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { FAMILIES, MODES, SENIORITIES } from "./JobsTypes";
import { ROLE_STATUS_FILTER_ORDER } from "./jobsRoleStatus";
import type { JobSortCol } from "./jobsTableView";
import type { SortState } from "@/app/_components/table/useTableSort";
import type { useJobsList } from "./useJobsList";

// The corpus table's shell: an sr-only caption and the header row.
//
// The header used to be seven inert `<Th>` labels over a `max-h-[70vh]` scroll
// box, with the filters in a toolbar above the table and no sorting anywhere —
// which meant this table, the longest in the studio, was the one place none of
// the shared table kit was used. It now carries the same register as every other
// ledger (ProfileRoster, the Channels comms ledger, the JD ledger): the sortable
// `ColumnHead` (which owns `aria-sort` — the hand-rolled `Th` never claimed it),
// spreadsheet-style `ColumnFilter` triggers IN the headers, and — from
// JobsTabResults — the shared 20-row `TablePager` instead of an endless scroll
// pane that mounted all 105 rows at once.
//
// Filters AND sort are server-side: each menu or header click writes `useJobsList`
// state, which re-queries `/api/jobs` for one 20-row window of the whole set.
export function JobsTableFrame({
  children,
  list,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  list: ReturnType<typeof useJobsList>;
  sort: SortState<JobSortCol>;
  onSort: (col: JobSortCol) => void;
}) {
  const t = useTranslations("jobs.table");
  // The four derived role statuses share ONE label set with the badge in the row
  // (JobsShared.RoleStatusCell) — a menu entry that read differently from the chip
  // it filters for would be two vocabularies for one fact.
  const tStatus = useTranslations("jobs.roleStatus");
  const enumLabel = useEnumLabel();
  const opts = (group: string, values: readonly string[]): Option[] =>
    values.map((v) => ({ value: v, label: enumLabel(group, v) }));
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full min-w-[52rem] border-collapse text-left">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60">
            <th scope="col" className="w-8 px-2 py-2">
              <span className="sr-only">{t("expandRow")}</span>
            </th>
            {/* Role carries both controls: sort, and the corpus search behind the
                magnifier — the free-text box that used to sit in the toolbar. */}
            <ColumnHead title={t("colRole")} sortCol="title" sort={sort} onSort={onSort} className="px-4 py-2">
              <ColumnFilter title={t("colRole")} mode="search" trigger="icon" value={list.q} onChange={list.setQ} />
            </ColumnHead>
            <ColumnHead title={t("colLocation")} sortCol="location" sort={sort} onSort={onSort} className="px-4 py-2" />
            <ColumnHead title={t("colMode")} sortCol="mode" sort={sort} onSort={onSort} className="px-4 py-2">
              <ColumnFilter title={t("colMode")} trigger="icon" value={list.workMode} onChange={list.setWorkMode} options={opts("workMode", MODES)} />
            </ColumnHead>
            <ColumnHead title={t("colSeniority")} sortCol="seniority" sort={sort} onSort={onSort} className="px-4 py-2">
              <ColumnFilter
                title={t("colSeniority")}
                trigger="icon"
                value={list.seniority}
                onChange={list.setSeniority}
                options={opts("seniority", SENIORITIES)}
              />
            </ColumnHead>
            <ColumnHead title={t("colFamily")} sortCol="family" sort={sort} onSort={onSort} className="px-4 py-2">
              <ColumnFilter
                title={t("colFamily")}
                trigger="icon"
                value={list.roleFamily}
                onChange={list.setRoleFamily}
                options={opts("family", FAMILIES)}
              />
            </ColumnHead>
            <ColumnHead title={t("colSalary")} sortCol="salary" sort={sort} onSort={onSort} className="px-4 py-2" />
            {/* THE ROLE'S OWN LIFECYCLE, which is what this desk is now for: the
                register of open and historical roles. It replaced the Entry column
                — entry-eligibility is a fairness fact about the requirements, still
                carried by the stat chip above the table and by the posting modal,
                but it is not what a recruiter opens this desk to read.
                The filter is a server predicate over every row; the menu's order
                is the desk's reading order, not the alphabet. */}
            <ColumnHead title={t("colStatus")} sortCol="status" sort={sort} onSort={onSort} className="px-4 py-2">
              <ColumnFilter
                title={t("colStatus")}
                trigger="icon"
                value={list.roleStatus}
                onChange={list.setRoleStatus}
                options={ROLE_STATUS_FILTER_ORDER.map((value) => ({ value, label: tStatus(value) }))}
              />
            </ColumnHead>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}
