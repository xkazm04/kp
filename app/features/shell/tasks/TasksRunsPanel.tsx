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
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { TableStatus } from "@/app/_components/table/TableStatus";
import type { Task, TaskStatus } from "./TasksProvider";
import { ACTIVE, RECENT_WINDOW_DAYS, SEEN_DWELL_MS, sortTasks, unseenIdsOf } from "./tasksTabHelpers";
import { TasksTable } from "./TasksTable";
import { TasksTableRow } from "./TasksTableRow";

export function TasksRunsPanel({
  loaded,
  loadFailed,
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
  onSeen,
  onRetryLoad,
}: {
  loaded: boolean;
  /** The last poll failed — an empty `tasks` here means "unknown", not "none". */
  loadFailed: boolean;
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
  /** Acknowledge finished outcomes (read/unread). Must be referentially STABLE —
   *  it gates the dwell timer below, which an unstable prop would restart every
   *  poll tick and never fire. */
  onSeen: (ids: string[]) => void;
  onRetryLoad: () => void;
}) {
  const t = useTranslations("tasks");
  const [page, setPage] = useState(0);

  // Computed BEFORE the early returns below: the dwell-ack effect must run on
  // every render (rules of hooks), and it needs the page slice.
  const rows = sortTasks(tasks);
  const safePage = clampPage(page, rows.length);
  const shown = pageSlice(rows, safePage);

  // Read/unread ack. It lives HERE, over `shown`, because this is the only place
  // that knows which rows are actually drawn: the tab used to ack every unread row
  // in the polled window (up to 60) while the table renders 20 of them, so opening
  // the tab cleared the sidebar's unread — and FAILED — badges for outcomes on
  // pages the recruiter never turned to. Keyed by the visible id set so a run that
  // finishes while the tab is open gets its own dwell.
  const ackKey = unseenIdsOf(shown).join(",");
  useEffect(() => {
    if (!ackKey) return;
    const ids = ackKey.split(",");
    const timer = window.setTimeout(() => onSeen(ids), SEEN_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [ackKey, onSeen]);

  if (!loaded && tasks.length === 0 && !filtering) {
    // Tier 2 (docs/design/loading-choreography.md): the first poll hasn't landed
    // yet — hold the table's height, invisibly, rather than asserting "no recent
    // tasks" about a window we haven't actually checked yet.
    return <div className="reveal-quiet min-h-[16rem]" aria-hidden />;
  }

  if (loadFailed && tasks.length === 0) {
    // The poll could not read the queue, so we know NOTHING about the window —
    // "No recent AI tasks" would be a confident lie told over runs that may well
    // be in flight. Say what actually happened and offer the same Refresh.
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coral/40 bg-coral/5 px-4 py-3">
        <p className="flex items-center gap-2 text-base text-coral">
          <AlertTriangle size={15} className="shrink-0" aria-hidden />
          {t("unreachable")}
        </p>
        <button
          type="button"
          onClick={onRetryLoad}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper"
        >
          <RefreshCw size={13} aria-hidden />
          {t("refresh")}
        </button>
      </div>
    );
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

  const activeCount = rows.filter(ACTIVE).length;
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
        {/* The summary line above is live, but it counts active vs done — it does
            not move when a filter narrows the window, so the narrowing itself was
            never announced. */}
        <TableStatus matched={rows.length} filtered={filtering} />
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
