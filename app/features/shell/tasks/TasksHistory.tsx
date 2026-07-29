"use client";

// On-demand history of finished tasks older than the recent window, split out of
// TasksTab.tsx so it stays under the 200-line file cap. Reuses the shared
// infinite-scroll engine (same one behind the analytics audit log) to page in 20
// at a time, with each freshly loaded page cascading in unless the user prefers
// reduced motion. kind/status narrow server-side (DATA6); the free-text filter
// applies client-side over the loaded pages, same as the live window.
import { useCallback } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import type { Task, TaskStatus } from "./TasksProvider";
import { DoneRow } from "./TasksDoneRow";
import { HISTORY_PAGE_SIZE, RECENT_WINDOW_DAYS } from "./tasksTabHelpers";

export function TaskHistory({ kind, status, text }: { kind: string; status: TaskStatus | null; text: string }) {
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
    errorLabel: "Couldn't load task history.",
  });

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-h2 text-ink">History</h3>
        <span className="text-meta uppercase text-steel">
          {total != null && items.length > 0 ? `${items.length} of ${total} · ` : ""}older than {RECENT_WINDOW_DAYS} days
        </span>
      </div>

      {showInitialSkeleton ? (
        // Tier 2: the first history page is in flight and there's nothing to
        // show yet — hold roughly 5 rows' worth of height, invisibly, instead
        // of drawing rows that don't exist (was 5 pulsing HistorySkeletonRow).
        <div className="mt-3 reveal-quiet min-h-[15rem]" aria-hidden />
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">No tasks older than {RECENT_WINDOW_DAYS} days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy={phase === "more"}>
          {items
            .filter((t) => !text || (t.label ?? t.kind).toLowerCase().includes(text))
            .map((t, i) => (
              <DoneRow key={t.id} task={t} animateDelayMs={reduced ? null : (i % HISTORY_PAGE_SIZE) * 18} />
            ))}
          {phase === "more" ? (
            // Tier 2: a next page is loading BELOW the rows already on screen —
            // reserve its height without touching what's already rendered.
            <li className="reveal-quiet min-h-[9rem]" aria-hidden />
          ) : null}
        </ul>
      )}

      {phase === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error ?? "Couldn't load task history."}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="focus-ring shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Retry
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
            {phase === "more" ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : !hasMore && items.length > 0 && phase === "idle" ? (
        <p className="mt-3 text-center text-sm text-steel">End of history · {items.length} tasks</p>
      ) : null}
    </div>
  );
}
