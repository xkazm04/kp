"use client";

import { SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusLegend } from "@/app/_components/StatusChip";
import { clampPage, TablePager } from "@/app/_components/table/TablePager";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Job } from "./JobsTypes";
import { EmptyState } from "./JobsShared";
import { JobsTableFrame } from "./JobsTable";
import { JobRow } from "./JobsRow";
import { JobsEmptyLaunchpad } from "./JobsEmptyLaunchpad";
import type { useJobsList } from "./useJobsList";

// The "showing X of Y" summary line, the lifecycle toggle, and the table body.
//
// This is where the corpus joined the studio's shared table kit. It used to
// render EVERY row the query returned into one `max-h-[70vh]` scroll pane — 105
// rows on the demo corpus, all mounted, with the filters left in a toolbar far
// above them and no ordering at all. Now: sort, status and the 20-row window are
// the SERVER's (useJobsList sends them; the route answers one page of the whole
// matching set), the shared `TablePager` driven by `matching`, and the filters in the column headers
// (JobsTable.tsx). The filter TOOLBAR is gone with them; the one control that has
// no column to live in — "open roles only", a lifecycle predicate over the whole
// query rather than a value in any cell — sits here as a toggle chip beside the
// count it changes.
//
// list.page is the route's triple (matching = every row the filters match);
// list.pageIndex is which 20-row window of it the server answered.
export function JobsTabResults({
  list,
  onOpen,
  onImport,
}: {
  list: ReturnType<typeof useJobsList>;
  onOpen: (job: Job) => void;
  onImport?: () => void;
}) {
  const t = useTranslations("jobs.tab");
  // ONE `enums` translator subscription for the whole table, passed down. Each row
  // used to open its own, so a 300-row catalog paid for 300 of them per render.
  const enumLabel = useEnumLabel();
  const { jobs, stats, page, error, fetching, anyFilter, clearAll, openOnly, setOpenOnly, pageIndex, setPageIndex, sort, toggleSort: toggle } = list;
  // The pager counts the whole matching set, not the rows on screen.
  const total = page?.matching ?? jobs?.length ?? 0;
  const safePage = clampPage(pageIndex, total);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-base" aria-live="polite">
        {jobs && stats ? (
          // "Showing <matching> of <workspace total>": every matching role is
          // reachable through the pager now, so a multi-page answer is not a cut.
          <span className="text-steel">
            {t.rich("showing", {
              shown: total,
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
            <JobsEmptyLaunchpad onImport={onImport} />
          )
        ) : (
          // A refetch (filter change) never blanks or dims the rows already on
          // screen — aria-busy alone carries the in-flight state.
          <div aria-busy={fetching} className="space-y-3">
            <JobsTableFrame list={list} sort={sort} onSort={toggle}>
              <tbody className="divide-y divide-stone-200">
                {jobs.map((job) => (
                  // `onOpen` takes the job so the row's memo boundary is not erased
                  // by a fresh arrow per row per render.
                  <JobRow key={job.id} job={job} onOpen={onOpen} enumLabel={enumLabel} />
                ))}
              </tbody>
            </JobsTableFrame>
            <TablePager page={safePage} total={total} onPage={setPageIndex} />
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
