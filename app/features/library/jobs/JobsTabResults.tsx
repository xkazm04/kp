"use client";

import { SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Job, Stats } from "./JobsTypes";
import { EmptyState } from "./JobsShared";
import { JobsTableFrame } from "./JobsTable";
import { JobRow } from "./JobsRow";
import { JobsEmptyLaunchpad } from "./JobsEmptyLaunchpad";

// The "showing X of Y" summary line + clear-filters chip, and the main
// table/empty-state body — extracted verbatim from JobsTab.tsx so that file
// stays under the 200-line split threshold.
export function JobsTabResults({
  jobs,
  stats,
  error,
  fetching,
  anyFilter,
  clearAll,
  onOpen,
}: {
  jobs: Job[] | null;
  stats: Stats | null;
  error: string | null;
  fetching: boolean;
  anyFilter: boolean;
  clearAll: () => void;
  onOpen: (job: Job) => void;
}) {
  const t = useTranslations("jobs.tab");
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
          // yet. Column headers still render (JobsTableFrame); the body holds
          // the rows' height and stays invisible for 150ms so a fast response
          // paints nothing at all. (Was a 9-row pulsing skeleton.)
          <JobsTableFrame>
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
          <div aria-busy={fetching}>
            <JobsTableFrame>
              <tbody className="divide-y divide-stone-200">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => onOpen(job)} />
                ))}
              </tbody>
            </JobsTableFrame>
          </div>
        )}
      </div>
    </>
  );
}
