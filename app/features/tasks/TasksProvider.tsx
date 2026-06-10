"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

/** Why a startTask() call never produced a task (bad kind, server error, dropped network). */
export type TaskStartError = { kind: string; message: string };

export type Task = {
  id: string;
  kind: string;
  label: string | null;
  status: TaskStatus;
  // IMPORTANT: `params` and `result` are ALWAYS null on tasks read from the polled
  // list (`tasks`/`running`/`findActive`). The server projects those (potentially
  // multi-MB) blobs out of GET /api/tasks so the 2s poll stays lightweight. To read
  // a finished task's result/params, fetch the full record with fetchTask(id) — or,
  // when watching a task you started, use the useTaskResult(taskId) hook below.
  params: unknown;
  result: unknown;
  error: string | null;
  progressDone: number;
  progressTotal: number;
  progressMsg: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Ctx = {
  tasks: Task[];
  running: Task[];
  /** Resolves to the started Task, or null if it never started (see `startError`). */
  startTask: (kind: string, params?: Record<string, unknown>) => Promise<Task | null>;
  /**
   * DATA1 — replay a failed/interrupted/canceled task from its persisted params
   * (server-side via POST /api/tasks/[id]/retry, so the blobs never round-trip).
   * Resolves to the NEW task, or null on failure (surfaced via `startError`).
   */
  retryTask: (id: string) => Promise<Task | null>;
  cancelTask: (id: string) => Promise<void>;
  refresh: () => void;
  /**
   * Fetch ONE full task (with its result + params) from GET /api/tasks/[id].
   * The polled list omits those blobs, so this is how a caller reads a finished
   * task's output. Resolves to null on a 404 / non-OK / network error.
   */
  fetchTask: (id: string) => Promise<Task | null>;
  /** active (queued/running) task matching a predicate — for dedup-aware UI. */
  findActive: (predicate: (t: Task) => boolean) => Task | undefined;
  /** Last start failure, surfaced by the indicator so a dead click isn't silent. */
  startError: TaskStartError | null;
  clearStartError: () => void;
};

const TasksContext = createContext<Ctx | null>(null);

export function useTasks(): Ctx {
  const c = useContext(TasksContext);
  if (!c) throw new Error("useTasks must be used within TasksProvider");
  return c;
}

const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [startError, setStartError] = useState<TaskStartError | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks");
      const p = await r.json();
      if (Array.isArray(p.tasks)) setTasks(p.tasks as Task[]);
    } catch {
      /* transient — next tick retries */
    }
  }, []);

  const startTask = useCallback(
    async (kind: string, params: Record<string, unknown> = {}) => {
      try {
        const r = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, params }),
        });
        const p = (await r.json().catch(() => ({}))) as { task?: Task; error?: string };
        if (!r.ok) throw new Error(p.error || `Request failed (${r.status})`);
        setStartError(null);
        void refresh();
        return p.task as Task;
      } catch (e) {
        // Don't swallow it: a 400 (unknown kind), a 500, or a dropped network call
        // would otherwise make the click a silent no-op. Surface it via the indicator.
        setStartError({ kind, message: e instanceof Error && e.message ? e.message : "Couldn't reach the server." });
        return null;
      }
    },
    [refresh]
  );

  const cancelTask = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        void refresh();
      } catch {
        /* ignore */
      }
    },
    [refresh]
  );

  const retryTask = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/tasks/${id}/retry`, { method: "POST" });
        const p = (await r.json().catch(() => ({}))) as { task?: Task; error?: string };
        if (!r.ok) throw new Error(p.error || `Request failed (${r.status})`);
        setStartError(null);
        void refresh();
        return p.task ?? null;
      } catch (e) {
        // Same contract as startTask: a dead retry click must never be silent.
        setStartError({ kind: "retry", message: e instanceof Error && e.message ? e.message : "Couldn't reach the server." });
        return null;
      }
    },
    [refresh]
  );

  // On-demand fetch of a single full task — the only path to a task's result/params,
  // which the polled list deliberately omits. Swallows failures into null so callers
  // can simply retry on the next poll tick (see useTaskResult).
  const fetchTask = useCallback(async (id: string): Promise<Task | null> => {
    try {
      const r = await fetch(`/api/tasks/${id}`);
      if (!r.ok) return null;
      const p = (await r.json().catch(() => ({}))) as { task?: Task };
      return p.task ?? null;
    } catch {
      return null;
    }
  }, []);

  // Poll while mounted (above the tabs → survives view switches; re-reads running
  // tasks on mount → survives a page refresh). Pause when the tab is hidden.
  // The activity flag is written in a commit-phase effect (never during render —
  // render must stay pure); the polling loop only reads it on its next tick, so
  // post-commit freshness is exactly enough.
  const anyActive = useRef(false);
  useEffect(() => {
    anyActive.current = tasks.some(ACTIVE);
  }, [tasks]);
  useEffect(() => {
    // Deferred kick-off: the first refresh runs on an immediate (0 ms) timer
    // tick rather than synchronously in the effect body — refresh sets state,
    // and a sync setState here would cascade a second render before the first
    // commit settles. Mount behavior is unchanged: data still loads right away.
    let cancelled = false;
    let timeout: number;
    const loop = (delay: number) => {
      if (cancelled) return;
      timeout = window.setTimeout(async () => {
        if (!document.hidden) await refresh();
        loop(anyActive.current ? 2000 : 6000);
      }, delay);
    };
    loop(0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const value: Ctx = {
    tasks,
    running: tasks.filter(ACTIVE),
    startTask,
    retryTask,
    cancelTask,
    refresh,
    fetchTask,
    findActive: (predicate) => tasks.find((t) => ACTIVE(t) && predicate(t)),
    startError,
    clearStartError: () => setStartError(null),
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

/**
 * Watch a task you started through to completion and get its full result/params.
 *
 * The polled list (GET /api/tasks) omits each task's heavy result/params blobs, so
 * the common UI pattern "kick off a task, then read its `.result` off the polled
 * list once it succeeds" no longer works directly. This hook bridges the gap: it
 * tracks `taskId` via the live poll for cheap status/error/progress, and once the
 * task reaches a terminal state it fetches the FULL record ONCE from
 * GET /api/tasks/[id] and exposes it as `full` (so you read `full.result` /
 * `full.params`). A transient fetch failure leaves `full` null and retries on the
 * next poll tick. Pass null to watch nothing (e.g. before a task is started).
 */
export function useTaskResult(taskId: string | null): {
  /** Live status from the poll (null when not watching a task). */
  status: TaskStatus | null;
  /** queued || running, from the poll. */
  active: boolean;
  /** Live error string from the poll, for failed/interrupted tasks. */
  error: string | null;
  /** Live progress message from the poll (cheap — carried by the list). */
  progressMsg: string | null;
  /** The full task (result + params populated), once fetched. null until then. */
  full: Task | null;
  /** True from when the task finishes until its full result has been fetched. */
  loading: boolean;
} {
  const { tasks, fetchTask } = useTasks();
  const polled = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;
  const status = polled?.status ?? null;
  const error = polled?.error ?? null;
  const progressMsg = polled?.progressMsg ?? null;
  const active = status === "running" || status === "queued";
  const terminal = status != null && !active;

  // Cache the last fetched full task, keyed by id: a change of taskId makes `full`
  // fall back to null on the very next render with no reset effect, and a stale
  // in-flight response for a previous id can never surface.
  const [fetched, setFetched] = useState<Task | null>(null);
  const full = fetched && taskId != null && fetched.id === taskId ? fetched : null;
  // The id we currently have a request in flight for (or null) — blocks overlapping
  // or duplicate fetches while still allowing a retry after a transient failure.
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    // Fetch the result/params the poll omits, once the task is done. Depending on
    // `polled` lets a transient failure retry on the next poll tick; the `full` and
    // inFlight guards stop that from looping once the result is in hand.
    if (!taskId || !terminal || full || inFlight.current === taskId) return;
    inFlight.current = taskId;
    let cancelled = false;
    void fetchTask(taskId).then((t) => {
      if (inFlight.current === taskId) inFlight.current = null;
      if (!cancelled && t) setFetched(t);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, terminal, full, fetchTask, polled]);

  return { status, active, error, progressMsg, full, loading: terminal && full === null };
}
