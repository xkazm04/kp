"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Ban, Check, Clock, Loader2, RefreshCw, X } from "lucide-react";
import { useTasks, type Task, type TaskStatus } from "./TasksProvider";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useInfiniteScroll, type InfinitePage } from "@/app/_lib/useInfiniteScroll";
import { formatRelativeTime } from "@/app/_lib/format";

// Default window the live view shows; older runs page in via the history table.
// Mirrors RECENT_TASK_WINDOW_DAYS in app/_lib/tasks.ts (server-only, so the value
// is restated here rather than imported into this client bundle).
const RECENT_WINDOW_DAYS = 7;
const HISTORY_PAGE_SIZE = 20;

type StatusMeta = {
  label: string;
  badge: string;
  Icon: typeof Check;
  iconCls: string;
};

const STATUS: Record<TaskStatus, StatusMeta> = {
  running: { label: "Running", badge: "bg-coral/10 text-coral", Icon: Loader2, iconCls: "animate-spin text-coral" },
  queued: { label: "Queued", badge: "bg-steel/10 text-steel", Icon: Clock, iconCls: "text-steel" },
  succeeded: { label: "Done", badge: "bg-moss/10 text-moss", Icon: Check, iconCls: "text-moss" },
  failed: { label: "Failed", badge: "bg-coral/10 text-coral", Icon: AlertTriangle, iconCls: "text-coral" },
  canceled: { label: "Canceled", badge: "bg-stone-100 text-steel", Icon: Ban, iconCls: "text-steel" },
  interrupted: { label: "Interrupted", badge: "bg-amber-100 text-amber-700", Icon: AlertTriangle, iconCls: "text-amber-600" },
};

const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";

function pct(t: Task): number {
  if (t.progressTotal <= 0) return t.status === "running" ? 8 : 0;
  return Math.round((t.progressDone / t.progressTotal) * 100);
}

// Tasks show "—" for a never-run/invalid timestamp; otherwise the shared
// relative-time renderer (formatRelativeTime, which returns "" on invalid).
function relTime(iso: string | null): string {
  return (iso && formatRelativeTime(iso)) || "—";
}

// Wall-clock a task took (or has been running). Falls back gracefully when a
// boundary timestamp is missing rather than rendering "NaN".
function duration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export function TasksTab() {
  const { tasks, cancelTask, refresh, startError, clearStartError } = useTasks();
  const [showHistory, setShowHistory] = useState(false);
  const active = tasks.filter(ACTIVE);
  const done = tasks.filter((t) => !ACTIVE(t));

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-stone-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">Activity</p>
          <h2 className="mt-1 font-serif text-display text-ink">Background tasks</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            Long-running actions — analysis, screening, JD builds, group evaluations — run here in the background. Watch
            them progress and review what finished, even after switching tabs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </header>

      {startError ? (
        <div className="flex items-start gap-2 rounded-lg border border-coral/40 bg-coral/5 p-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-coral" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-coral">Couldn&apos;t start the task</p>
            <p className="break-words text-sm text-steel">{startError.message}</p>
          </div>
          <button
            type="button"
            onClick={clearStartError}
            title="Dismiss"
            className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {active.length === 0 && done.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center">
          <Clock size={20} className="mx-auto text-steel" />
          <p className="mt-2 text-base font-medium text-ink">No recent background tasks</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-steel">
            Active and recently finished runs (last {RECENT_WINDOW_DAYS} days) appear here. Older runs are available
            under “Show history” below.
          </p>
        </div>
      ) : (
        <>
          <Group title="In progress" count={active.length}>
            {active.length === 0 ? (
              <p className="text-base text-steel">Nothing running right now.</p>
            ) : (
              <ul className="space-y-3">
                {active.map((t) => (
                  <ActiveCard key={t.id} task={t} onCancel={() => void cancelTask(t.id)} />
                ))}
              </ul>
            )}
          </Group>

          {done.length > 0 ? (
            <Group title={`Done · last ${RECENT_WINDOW_DAYS} days`} count={done.length}>
              <ul className="divide-y divide-stone-100">
                {done.map((t) => (
                  <DoneRow key={t.id} task={t} />
                ))}
              </ul>
            </Group>
          ) : null}
        </>
      )}

      {/* Older runs are loaded only on demand — checking this reveals a history
          table that pages in 20 at a time, so the trail is never loaded at once. */}
      <label className="flex w-fit cursor-pointer items-center gap-2 text-base text-steel">
        <input
          type="checkbox"
          checked={showHistory}
          onChange={(e) => setShowHistory(e.target.checked)}
          className="focus-ring h-4 w-4 rounded border-stone-300 text-coral"
        />
        Show history (tasks older than {RECENT_WINDOW_DAYS} days)
      </label>

      {showHistory ? <TaskHistory /> : null}
    </section>
  );
}

// On-demand history of finished tasks older than the recent window. Reuses the
// shared infinite-scroll engine (same one behind the analytics audit log) to
// page in 20 at a time, with each freshly loaded page cascading in unless the
// user prefers reduced motion.
function TaskHistory() {
  const reduced = useReducedMotion();
  const buildUrl = useCallback((offset: number, limit: number) => `/api/tasks/history?offset=${offset}&limit=${limit}`, []);
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
        <ul className="mt-3 divide-y divide-stone-100" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <HistorySkeletonRow key={i} />
          ))}
        </ul>
      ) : phase === "idle" && items.length === 0 ? (
        <p className="mt-3 text-base text-steel">No tasks older than {RECENT_WINDOW_DAYS} days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100" aria-busy={phase === "more"}>
          {items.map((t, i) => (
            <DoneRow key={t.id} task={t} animateDelayMs={reduced ? null : (i % HISTORY_PAGE_SIZE) * 18} />
          ))}
          {phase === "more" ? Array.from({ length: 3 }).map((_, i) => <HistorySkeletonRow key={`s${i}`} />) : null}
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

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-h2 text-ink">{title}</h3>
        <span className="text-meta uppercase text-steel">{count}</span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ActiveCard({ task, onCancel }: { task: Task; onCancel: () => void }) {
  const meta = STATUS[task.status];
  return (
    <li className="rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
          <meta.Icon size={11} className={meta.iconCls} />
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{task.label ?? task.kind}</span>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel task"
          className="focus-ring shrink-0 rounded p-1 text-steel hover:bg-stone-100 hover:text-coral"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-coral transition-all duration-500" style={{ width: `${Math.max(6, pct(task))}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-sm text-steel">
        <span className="min-w-0 truncate">
          {task.progressTotal > 0 ? `${task.progressDone}/${task.progressTotal} · ` : ""}
          {task.progressMsg ?? (task.status === "queued" ? "queued…" : "working…")}
        </span>
        <span className="shrink-0 font-mono text-sm text-steel/80">{task.kind}</span>
      </div>
    </li>
  );
}

// `animateDelayMs` cascades a freshly loaded history page in; live (last-7-days)
// rows omit it so polling never re-triggers motion. CSS animations only fire on
// mount, so already-present rows never re-animate regardless.
function DoneRow({ task, animateDelayMs = null }: { task: Task; animateDelayMs?: number | null }) {
  const { retryTask } = useTasks();
  const [retrying, setRetrying] = useState(false);
  const meta = STATUS[task.status];
  const dur = duration(task.startedAt, task.finishedAt);
  const failed = task.status === "failed" || task.status === "interrupted";
  // DATA1 — every dead-end terminal row can replay from its persisted params;
  // the new run appears in "In progress" via the existing poll (the old row
  // stays as the audit record of the failure).
  const retryable = task.status === "failed" || task.status === "interrupted" || task.status === "canceled";
  const animate = animateDelayMs != null;
  return (
    <li
      className={`flex items-start gap-3 py-2.5 ${animate ? "animate-fade-in" : ""}`}
      style={animate ? { animationDelay: `${animateDelayMs}ms` } : undefined}
    >
      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${meta.badge}`}>
        <meta.Icon size={11} className={meta.iconCls} />
        {meta.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-ink">{task.label ?? task.kind}</p>
        {failed && task.error ? <p className="mt-0.5 break-words text-sm text-coral">{task.error}</p> : null}
        <p className="mt-0.5 font-mono text-sm text-steel/70">{task.kind}</p>
      </div>
      {retryable ? (
        <button
          type="button"
          onClick={() => {
            setRetrying(true);
            void retryTask(task.id).finally(() => setRetrying(false));
          }}
          disabled={retrying}
          title="Run this task again with the same inputs"
          className="focus-ring mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-60"
        >
          <RefreshCw size={12} className={retrying ? "animate-spin" : ""} /> Retry
        </button>
      ) : null}
      <div className="shrink-0 text-right text-sm text-steel">
        <p>{relTime(task.finishedAt ?? task.startedAt ?? task.createdAt)}</p>
        {dur ? <p className="text-sm text-steel/70">took {dur}</p> : null}
      </div>
    </li>
  );
}

function HistorySkeletonRow() {
  return (
    <li className="flex items-start gap-3 py-2.5" aria-hidden>
      <span className="mt-0.5 h-5 w-16 shrink-0 animate-pulse rounded-full bg-stone-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3.5 w-2/3 animate-pulse rounded bg-stone-100" />
        <span className="block h-3 w-1/4 animate-pulse rounded bg-stone-100" />
      </div>
      <span className="h-3 w-12 shrink-0 animate-pulse rounded bg-stone-100" />
    </li>
  );
}
