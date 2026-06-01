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
  cancelTask: (id: string) => Promise<void>;
  refresh: () => void;
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

  // Poll while mounted (above the tabs → survives view switches; re-reads running
  // tasks on mount → survives a page refresh). Pause when the tab is hidden.
  const anyActive = useRef(false);
  anyActive.current = tasks.some(ACTIVE);
  useEffect(() => {
    void refresh();
    let cancelled = false;
    let timeout: number;
    const loop = () => {
      if (cancelled) return;
      timeout = window.setTimeout(async () => {
        if (!document.hidden) await refresh();
        loop();
      }, anyActive.current ? 2000 : 6000);
    };
    loop();
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
    cancelTask,
    refresh,
    findActive: (predicate) => tasks.find((t) => ACTIVE(t) && predicate(t)),
    startError,
    clearStartError: () => setStartError(null),
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
