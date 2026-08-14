"use client";

// The tab's main surface: ONE paginated, column-filtered table over the recent
// window, replacing the two stacked card lists (In progress / Done) this tab used
// to draw. The old shape had a "Nothing running right now." panel permanently
// occupying the top of the screen, a second heading below it, no shared sort, and
// a Done list that grew without bound inside a card — so a busy workspace scrolled
// past dozens of rows with no sense of position. The table follows the studio's
// established practice (the Activity log, the comms ledger, the Archetypes
// roster): ColumnFilter headers + the shared 20-row TablePager.
//
// Active runs sort to the top (sortTasks), which is what the two headings were
// really encoding — so consolidating loses no information and gains one sort, one
// filter set and one pager over the whole window.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import type { Task, TaskStatus } from "./TasksProvider";
import { ACTIVE, RECENT_WINDOW_DAYS, sortTasks } from "./tasksTabHelpers";
import { TasksTable } from "./TasksTable";
import { TasksTableRow } from "./TasksTableRow";

export function TasksRunsPanel({
  loaded,
  tasks,
  kinds,
  textFilter,
  setTextFilter,
  kindFilter,
  setKindFilter,
  statusFilter,
  setStatusFilter,
  filtering,
  onClearFilters,
  onCancel,
}: {
  loaded: boolean;
  /** The window already narrowed by the active filters. */
  tasks: Task[];
  kinds: string[];
  textFilter: string;
  setTextFilter: (value: string) => void;
  kindFilter: string;
  setKindFilter: (value: string) => void;
  statusFilter: TaskStatus | null;
  setStatusFilter: (value: TaskStatus | null) => void;
  filtering: boolean;
  onClearFilters: () => void;
  onCancel: (id: string) => void;
}) {
  const t = useTranslations("tasks");
  const [page, setPage] = useState(0);

  if (!loaded && tasks.length === 0 && !filtering) {
    // Tier 2 (docs/design/loading-choreography.md): the first poll hasn't landed
    // yet — hold the table's height, invisibly, rather than asserting "no recent
    // tasks" about a window we haven't actually checked yet.
    return <div className="reveal-quiet min-h-[16rem]" aria-hidden />;
  }

  if (tasks.length === 0 && !filtering) {
    return (
      <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center">
        <Clock size={20} className="mx-auto text-steel" aria-hidden />
        <p className="mt-2 text-base font-medium text-ink">{t("results.emptyTitle")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-steel">{t("results.emptyBody", { days: RECENT_WINDOW_DAYS })}</p>
      </div>
    );
  }

  const rows = sortTasks(tasks);
  const activeCount = rows.filter(ACTIVE).length;
  const safePage = clampPage(page, rows.length);
  const shown = pageSlice(rows, safePage);
  // Every filter change re-pages from the top: page 3 of an unfiltered window is
  // not page 3 of a narrowed one, and clampPage alone would leave the reader on a
  // page whose rows are unrelated to what they just asked for.
  const refiltered = <T,>(apply: (value: T) => void) => (value: T) => {
    apply(value);
    setPage(0);
  };

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-serif text-h3 text-ink">{t("table.title")}</h3>
        <span className={META_LABEL}>{t("table.meta", { days: RECENT_WINDOW_DAYS })}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm text-steel nums" aria-live="polite">
          {t("table.summary", { active: activeCount, done: rows.length - activeCount })}
        </p>
        {filtering ? (
          <button
            type="button"
            onClick={() => {
              onClearFilters();
              setPage(0);
            }}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
          >
            {t("filter.clear")}
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        <TasksTable
          filters={{
            text: textFilter,
            onText: refiltered(setTextFilter),
            kind: kindFilter,
            onKind: refiltered(setKindFilter),
            status: statusFilter,
            onStatus: refiltered(setStatusFilter),
            kinds,
          }}
        >
          {shown.map((task) => (
            <TasksTableRow key={task.id} task={task} onCancel={onCancel} />
          ))}
        </TasksTable>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-base font-medium text-ink">{t("results.emptyFilteredTitle")}</p>
          <p className="mt-1 text-sm text-steel">{t("results.emptyFilteredBody")}</p>
        </div>
      ) : (
        <div className="mt-3">
          <TablePager page={safePage} total={rows.length} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
