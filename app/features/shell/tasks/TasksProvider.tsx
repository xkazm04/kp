"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  initialTasksPollState,
  pollDelayMs,
  queueUnreachable,
  tasksPollReducer,
  type TasksPollEvent,
  type TasksPollState,
} from "@/app/_lib/task-poll-state";
import { resolveErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { ACTIVE, type Task, type TasksCtx } from "./tasksProviderTypes";

export type { Task, TaskStatus, TaskStartError } from "./tasksProviderTypes";
// useTaskResult lives in its own module (useTaskResult.ts) so this file stays
// under the 200-line cap; re-exported here so every existing import path
// (`@/app/features/shell/tasks/TasksProvider`) keeps working unchanged.
export { useTaskResult, RESULT_FETCH_MAX_ATTEMPTS } from "./useTaskResult";

const TasksContext = createContext<TasksCtx | null>(null);

export function useTasks(): TasksCtx {
  const c = useContext(TasksContext);
  if (!c) throw new Error("useTasks must be used within TasksProvider");
  return c;
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  // `startError.message` is rendered verbatim by TasksIndicator/TasksTab, so the
  // route's English `error` must never become that message: resolve the machine
  // `code` and fall back to this namespace's own copy (app/_lib/use-error-message.ts).
  // The pure resolveErrorMessage rather than useErrorMessage() because the hook
  // returns a FRESH closure each render — in deps it would destabilize the
  // memoized callbacks below (and with them the context value, whose whole point
  // is not to re-render every consumer on each poll tick). `t` is stable.
  const t = useTranslations("tasks");
  const tErrors = useTranslations("errors");
  const errMsg = useCallback(
    (payload: ApiErrorPayload, fallback: string) => {
      type ErrorKey = Parameters<typeof tErrors>[0];
      return resolveErrorMessage(payload, fallback, (c) => tErrors.has(c as ErrorKey), (c) => tErrors(c as ErrorKey));
    },
    [tErrors]
  );
  // ONE reducer for the polled rows, the health flags and the last action error —
  // extracted to app/_lib/task-poll-state.ts so node --test can pin the parts that
  // used to live untested inside this .tsx: the signature bail-out (an unchanged
  // poll returns the SAME state object, so no consumer re-renders), the loadFailed
  // third state, and the consecutive-failure count the backoff below reads.
  const [state, dispatch] = useReducer(
    tasksPollReducer as (s: TasksPollState<Task>, e: TasksPollEvent<Task>) => TasksPollState<Task>,
    undefined,
    initialTasksPollState<Task>
  );
  const { tasks, startError, loadFailed } = state;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks");
      const p = (await r.json().catch(() => ({}))) as { tasks?: unknown };
      if (!r.ok || !Array.isArray(p.tasks)) {
        dispatch({ type: "pollFailed" });
        return;
      }
      dispatch({ type: "polled", tasks: p.tasks as Task[] });
    } catch {
      /* transient — the next (backed-off) tick retries, and the flag lets the view say so meanwhile */
      dispatch({ type: "pollFailed" });
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
        const p = (await r.json().catch(() => ({}))) as { task?: Task; error?: string; code?: string };
        if (!r.ok) throw new Error(errMsg(p, t("startErrorTitle")));
        dispatch({ type: "actionOk" });
        void refresh();
        return p.task as Task;
      } catch (e) {
        // Don't swallow it: a 400 (unknown kind), a 500, or a dropped network call
        // would otherwise make the click a silent no-op. Surface it via the indicator.
        dispatch({ type: "actionFailed", kind, message: e instanceof Error && e.message ? e.message : t("unreachable") });
        return null;
      }
    },
    [refresh, t, errMsg]
  );

  const cancelTask = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        const p = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
        if (!r.ok) throw new Error(errMsg(p, t("cancelErrorTitle")));
        void refresh();
      } catch (e) {
        // Same contract as startTask: a dead Cancel must never be silent — the
        // task keeps running and the user would conclude the button is broken.
        dispatch({ type: "actionFailed", kind: "cancel", message: e instanceof Error && e.message ? e.message : t("unreachable") });
      }
    },
    [refresh, t, errMsg]
  );

  const retryTask = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/tasks/${id}/retry`, { method: "POST" });
        const p = (await r.json().catch(() => ({}))) as { task?: Task; error?: string; code?: string };
        if (!r.ok) throw new Error(errMsg(p, t("startErrorTitle")));
        dispatch({ type: "actionOk" });
        void refresh();
        return p.task ?? null;
      } catch (e) {
        // Same contract as startTask: a dead retry click must never be silent.
        dispatch({ type: "actionFailed", kind: "retry", message: e instanceof Error && e.message ? e.message : t("unreachable") });
        return null;
      }
    },
    [refresh, t, errMsg]
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
  // The consecutive-failure count the loop re-arms on, mirrored into a ref for the
  // same reason as `anyActive`: the loop is created once and reads it on its next
  // tick. Without it the poll re-armed at a flat 2s against a DEAD endpoint —
  // 30 requests a minute per open tab, for as long as the server stayed down.
  const failures = useRef(0);
  useEffect(() => {
    failures.current = state.failures;
  }, [state.failures]);
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
        loop(pollDelayMs(anyActive.current, failures.current));
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

  const clearStartError = useCallback(() => dispatch({ type: "clearError" }), []);

  // Read/unread ack: stamp seen_at server-side, then refresh so the indicator
  // badge clears on the next paint. Best-effort — a failed ack just leaves the
  // rows unread; the tab retries on its next dwell.
  const markSeen = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        await fetch("/api/tasks/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        void refresh();
      } catch {
        /* best-effort — unread state persists until the next successful ack */
      }
    },
    [refresh]
  );

  // Memoize the context value so it only changes when the task list REALLY changes
  // (the signature-gated refresh above keeps `tasks` referentially stable across
  // no-op polls) or a start error flips — instead of rebuilding a fresh object,
  // `running` array, and `findActive` closure every render and cascading a
  // re-render through every consumer on each 2s tick. All the callbacks are stable
  // (useCallback), so `tasks` and `startError` are the only real inputs.
  const value = useMemo<TasksCtx>(
    () => ({
      tasks,
      running: tasks.filter(ACTIVE),
      startTask,
      retryTask,
      cancelTask,
      refresh,
      fetchTask,
      findActive: (predicate) => tasks.find((t) => ACTIVE(t) && predicate(t)),
      startError,
      clearStartError,
      markSeen,
      loadFailed,
      queueUnreachable: queueUnreachable(state),
    }),
    [tasks, startTask, retryTask, cancelTask, refresh, fetchTask, startError, clearStartError, markSeen, loadFailed, state]
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
