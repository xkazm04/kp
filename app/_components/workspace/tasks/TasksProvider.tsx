"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

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
  startTask: (kind: string, params?: Record<string, unknown>) => Promise<Task | null>;
  cancelTask: (id: string) => Promise<void>;
  refresh: () => void;
  /** active (queued/running) task matching a predicate — for dedup-aware UI. */
  findActive: (predicate: (t: Task) => boolean) => Task | undefined;
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
        const p = await r.json();
        if (!r.ok) throw new Error(p.error);
        void refresh();
        return p.task as Task;
      } catch {
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
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
