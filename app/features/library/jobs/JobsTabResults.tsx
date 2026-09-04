"use client";

import { SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusLegend } from "@/app/_components/StatusChip";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import type { Job } from "./JobsTypes";
import { EmptyState } from "./JobsShared";
import { JobsTableFrame } from "./JobsTable";
import { JobRow } from "./JobsRow";
import { JobsEmptyLaunchpad } from "./JobsEmptyLaunchpad";
import { JOB_SORT_ACCESSORS, type JobSortCol } from "./jobsTableView";
import type { useJobsList } from "./useJobsList";

// The "showing X of Y" summary line, the lifecycle toggle, and the table body.
//
// This is where the corpus joined the studio's shared table kit. It used to
// render EVERY row the query returned into one `max-h-[70vh]` scroll pane — 105
// rows on the demo corpus, all mounted, with the filters left in a toolbar far
// above them and no ordering at all. Now: sorting through the shared
// `useTableSort` (accessors in jobsTableView.ts), a fixed 20-row window through
// the shared `TablePager`, and the filters living in the column headers
// (JobsTable.tsx). The filter TOOLBAR is gone with them; the one control that has
// no column to live in — "open roles only", a lifecycle predicate over the whole
// query rather than a value in any cell — sits here as a toggle chip beside the
// count it changes.
export function JobsTabResults({ list, onOpen }: { list: ReturnType<typeof useJobsList>; onOpen: (job: Job) => void }) {
  const t = useTranslations("jobs.tab");
  const { jobs, stats, error, fetching, anyFilter, clearAll, openOnly, setOpenOnly, page, setPage } = list;
  // Sorting is client-side over the rows the query returned (the kit's contract);
  // filtering stays server-side in useJobsList.
  const { sorted, sort, toggle } = useTableSort<Job, JobSortCol>(jobs ?? [], JOB_SORT_ACCESSORS, { col: "title", dir: "asc" });
  // Clamped rather than reset: a filter that shortens the list under a reader on
  // the last page must land them on a page that exists. (The filter setters in
  // useJobsList already return to page 1 — this catches everything else, e.g. a
  // publish that drops a row out of an "open only" view.)
  const safePage = clampPage(page, sorted.length);
  const shown = pageSlice(sorted, safePage);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-base" aria-live="polite">
        {jobs && stats ? (
          <span className="text-steel">
            {t.rich("showing", {
              shown: jobs.length,
              total: stats.total,
              b: (chunks) => <span className="font-semibold nums text-ink">{chunks}</span>,
            })}
          </span>
        ) : null}
        {/* Lifecycle filter: hide drafts + closed roles (default off — the full
            catalog stays the baseline view). */}
        <button type="button" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)} className={CHIP_TOGGLE(openOnly)}>
          {t("openOnly")}
        </button>
        {anyFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
          >
            <X size={12} aria-hidden /> {t("clearAll")}
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : jobs == null ? (
          // Tier 2: the corpus fetch is in flight and there is nothing to show
          // yet. Column headers and their filters still render (JobsTableFrame);
          // the body holds the rows' height and stays invisible for 150ms so a
          // fast response paints nothing at all.
          <JobsTableFrame list={list} sort={sort} onSort={toggle}>
            <tbody>
              <tr>
                <td colSpan={8} className="p-0">
                  <div className="reveal-quiet min-h-[24rem]" aria-hidden />
                </td>
              </tr>
            </tbody>
          </JobsTableFrame>
        ) : jobs.length === 0 ? (
          anyFilter ? (
            // Filtered to zero: stays a plain one-line card with a filter reset —
            // no illustration, the corpus isn't empty, the view is.
            <EmptyState
              icon={SearchX}
              title={t("noRolesTitle")}
              body={t("noRolesBody")}
              action={
                <button
                  type="button"
                  onClick={clearAll}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:bg-stone-50"
                >
                  <X size={14} aria-hidden /> {t("clearAllFilters")}
                </button>
              }
            />
          ) : (
            // First run, nothing posted yet: an empty catalog is a briefing, not a
            // hole — the opening move names the two routes to a first role and the
            // chain a role unlocks downstream.
            <JobsEmptyLaunchpad />
          )
        ) : (
          // A refetch (filter change) never blanks or dims the rows already on
          // screen — aria-busy alone carries the in-flight state.
          <div aria-busy={fetching} className="space-y-3">
            <JobsTableFrame list={list} sort={sort} onSort={toggle}>
              <tbody className="divide-y divide-stone-200">
                {shown.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => onOpen(job)} />
                ))}
              </tbody>
            </JobsTableFrame>
            <TablePager page={safePage} total={sorted.length} onPage={setPage} />
            {/* ONE THREAD (gap 8) — the same five-state legend the Assignments
                ledger carries, so the vocabulary is learned once and holds for the
                rest of the thread. Only rendered beside real rows: a legend over an
                empty table explains nothing. */}
            <StatusLegend className="px-1" />
          </div>
        )}
      </div>
    </>
  );
}
