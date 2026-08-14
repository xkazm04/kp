"use client";

// The run table's shell: the scroll container, the column widths and the header
// row shared by the live window and the history pager, so the two read as one
// table split by age rather than as two unrelated lists.
//
// Filtering is spreadsheet-style (the shared ColumnFilter primitive the Activity
// log and the comms ledger use): the column header IS the filter trigger. That
// replaced the standalone filter bar this tab used to carry above the lists —
// a search box, a kind <select> and a row of status chips that named their
// columns a second time. Only the live table passes `filters`; the history table
// renders the same headers inert, because the live table's filters already
// narrow it (kind + status go to the endpoint, free text applies client-side).
import { useTranslations } from "next-intl";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import type { TaskStatus } from "./TasksProvider";
import { ALL_STATUSES } from "./tasksTabHelpers";

export type TasksTableFilters = {
  text: string;
  onText: (value: string) => void;
  kind: string;
  onKind: (value: string) => void;
  status: TaskStatus | null;
  onStatus: (value: TaskStatus | null) => void;
  /** The kinds present in the loaded window — the Kind menu's options. */
  kinds: string[];
};

export function TasksTable({ filters, children }: { filters?: TasksTableFilters; children: React.ReactNode }) {
  const t = useTranslations("tasks");
  const th = "pb-2 pr-3 font-semibold";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-base">
        <thead>
          <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
            <th className={th}>
              {filters ? (
                <ColumnFilter
                  title={t("table.colStatus")}
                  value={filters.status ?? ""}
                  onChange={(v) => filters.onStatus((v || null) as TaskStatus | null)}
                  options={ALL_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
                />
              ) : (
                t("table.colStatus")
              )}
            </th>
            <th className={th}>
              {filters ? (
                // Free text matches what the reader can SEE, so it runs over the
                // resolved (localized) label — the stored one is an encoded
                // catalog reference (app/_lib/task-label.ts).
                <ColumnFilter title={t("table.colTask")} value={filters.text} onChange={filters.onText} mode="search" />
              ) : (
                t("table.colTask")
              )}
            </th>
            <th className={th}>
              {filters ? (
                // Kind values are canonical wire slugs, not copy: listed verbatim.
                <ColumnFilter
                  title={t("table.colKind")}
                  value={filters.kind}
                  onChange={filters.onKind}
                  options={filters.kinds.map((k) => ({ value: k, label: k }))}
                />
              ) : (
                t("table.colKind")
              )}
            </th>
            <th className={th}>{t("table.colWhen")}</th>
            <th className={th}>{t("table.colTook")}</th>
            <th className="pb-2 text-right font-semibold">{t("table.colActions")}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
