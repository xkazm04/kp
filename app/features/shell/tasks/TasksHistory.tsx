"use client";

// On-demand history of finished tasks older than the recent window, split out of
// TasksTab.tsx so it stays under the 200-line file cap. Reuses the shared
// infinite-scroll engine (same one behind the analytics audit log) to page in 20
// at a time, with each freshly loaded page cascading in unless the user prefers
// reduced motion. kind/status narrow server-side (DATA6); the free-text filter
// applies client-side over the loaded pages, same as the live window.
//
// It renders the SAME table as the live window (TasksTable + TasksTableRow) —
// only the paging model differs, because history is a server-side cursor rather
// than an in-memory slice. Its headers are inert: the live table's column filters
// above already drive both.
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { CARD_PAD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { renderTaskLabel } from "@/app/_lib/task-label";
import { taskMatchesSearch } from "./taskSearch";
import type { Task, TaskStatus } from "./TasksProvider";
import { TasksTable } from "./TasksTable";
import { TasksTableRow } from "./TasksTableRow";
import { HISTORY_PAGE_SIZE, RECENT_WINDOW_DAYS, TERMINAL_STATUSES } from "./tasksTabHelpers";

/** Panel chrome (title + range meta), shared by the list and the not-applicable
 *  short-circuit below so both read as the same section. */
function HistoryPanel({ meta, children }: { meta: string; children: React.ReactNode }) {
  const t = useTranslations("tasks");
  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("history.title")}</h3>
        <span className={META_LABEL}>{meta}</span>
      </div>
      {children}
    </div>
  );
}

export function TaskHistory({ kind, status, text }: { kind: string; status: TaskStatus | null; text: string }) {
  const t = useTranslations("tasks");
  // The trail stores TERMINAL runs only. Filtering the live table by `running`
  // or `queued` therefore has no older counterpart, and the history endpoint
  // silently drops a status it doesn't recognise — which would have shown an
  // UNFILTERED trail under a filtered table. Say "nothing older" instead of
  // fetching a window the filter would not apply to.
  if (status !== null && !TERMINAL_STATUSES.includes(status)) {
    return (
      <HistoryPanel meta={t("history.olderThan", { days: RECENT_WINDOW_DAYS })}>
        <p className="mt-3 text-base text-steel">{t("history.empty", { days: RECENT_WINDOW_DAYS })}</p>
      </HistoryPanel>
    );
  }
  return <TaskHistoryList kind={kind} status={status} text={text} />;
}

function TaskHistoryList({ kind, status, text }: { kind: string; status: TaskStatus | null; text: string }) {
  const t = useTranslations("tasks");
  const reduced = useReducedMotion();
  const buildUrl = useCallback(
    (offset: number, limit: number) => {
      const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      if (kind) params.set("kind", kind);
      if (status) params.set("status", status);
      return `/api/tasks/history?${params.toString()}`;
    },
    [kind, status]
  );
  const selectPage = useCallback((body: unknown): InfinitePage<Task> => {
    const b = body as { tasks: Task[]; total: number; hasMore: boolean; nextOffset: number };
    return { items: b.tasks, total: b.total, hasMore: b.hasMore, nextOffset: b.nextOffset };
  }, []);
  const { items, total, hasMore, phase, showInitialSkeleton, error, sentinelRef, loadMore } = useInfiniteScroll<Task>({
    pageSize: HISTORY_PAGE_SIZE,
    buildUrl,
    selectPage,
    errorLabel: t("history.loadFailed"),
  });

  // `text` arrives ALREADY folded from TasksTab (taskSearchNeedle) — the same needle
  // the live window above is filtered by, so a run cannot match in one half of the
  // view and vanish in the other at the recent/history boundary.
  const shown = items.filter((task) => taskMatchesSearch(renderTaskLabel(t, task), task.kind, text));

  return (
    <HistoryPanel
      meta={
        total != null && items.length > 0
          ? t("history.rangeOlderThan", { shown: items.length, total, days: RECENT_WINDOW_DAYS })
          : t("history.olderThan", { days: RECENT_WINDOW_DAYS })
      }
    >
      {showInitialSkeleton ? (
        // Tier 2: the first history page is in flight and there's nothing to
        // show yet — hold roughly 5 rows' worth of height, invisibly, instead
        // of drawing rows that don't exist.
        <div className="reveal-quiet mt-3 min-h-[15rem]" aria-hidden />
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">{t("history.empty", { days: RECENT_WINDOW_DAYS })}</p>
      ) : (
        <div className="mt-3" aria-busy={phase === "more"}>
          <TasksTable>
            {shown.map((task, i) => (
              <TasksTableRow key={task.id} task={task} animateDelayMs={reduced ? null : (i % HISTORY_PAGE_SIZE) * 18} />
            ))}
          </TasksTable>
          {phase === "more" ? (
            // Tier 2: a next page is loading BELOW the rows already on screen —
            // reserve its height without touching what's already rendered.
            <div className="reveal-quiet min-h-[9rem]" aria-hidden />
          ) : null}
        </div>
      )}

      {phase === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error ?? t("history.loadFailed")}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="focus-ring shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {t("history.retry")}
          </button>
        </div>
      ) : null}

      {/* Sentinel + manual fallback — the observer drives auto-loading; the button
          covers keyboard users and environments without IntersectionObserver. */}
      {hasMore && phase !== "error" ? (
        <div ref={sentinelRef} className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={phase === "more"}
            className="focus-ring rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper disabled:opacity-60"
          >
            {phase === "more" ? t("history.loading") : t("history.loadMore")}
          </button>
        </div>
      ) : !hasMore && items.length > 0 && phase === "idle" ? (
        <p className="mt-3 text-center text-sm text-steel">{t("history.end", { count: items.length })}</p>
      ) : null}
    </HistoryPanel>
  );
}
