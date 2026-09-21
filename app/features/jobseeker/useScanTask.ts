"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task, TaskStatus } from "@/app/features/shell/tasks/tasksProviderTypes";
import type { ScanSummary } from "@/app/_lib/jobseeker/types";

// The seeker's "scan now" watcher. `useTaskResult` (shell/tasks) reads the recruiter
// Workspace's TasksProvider poll, and /me deliberately mounts none of that shell, so
// this is the one-task version: POST /api/jobseeker/scan → 202 {taskId}, then
// GET /api/tasks/[id] every two seconds until the task is terminal. The full record
// carries `result` (the ScanSummary), so no second fetch is needed.
//
// A transient poll failure is retried on the next tick; the hook gives up on the
// SAME id after MAX_POLL_FAILURES consecutive misses and says so (`unreachable`),
// rather than spinning "Scanning…" over a task that finished server-side.

const POLL_MS = 2_000;
const MAX_POLL_FAILURES = 10;

export type ScanTaskState = {
  taskId: string | null;
  status: TaskStatus | null;
  /** queued || running. */
  active: boolean;
  progressMsg: string | null;
  progressDone: number;
  progressTotal: number;
  /** The task's stored diagnostic (no code to resolve; rendered inside a localized sentence). */
  error: string | null;
  summary: ScanSummary | null;
  /** The poll could not reach the task record ten times in a row. */
  unreachable: boolean;
  /** The POST itself was refused; the API code, or null for a network failure. */
  startError: { code: string | null } | null;
  starting: boolean;
};

function isScanSummary(v: unknown): v is ScanSummary {
  return !!v && typeof v === "object" && Array.isArray((v as { sources?: unknown }).sources);
}

export function useScanTask(onFinished?: (summary: ScanSummary | null, status: TaskStatus) => void): ScanTaskState & { start(): Promise<void> } {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [failures, setFailures] = useState(0);
  const [startError, setStartError] = useState<{ code: string | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const finishedRef = useRef<string | null>(null);
  // Kept current in an effect, not during render (react-hooks/refs): the poll must
  // always call the latest callback without re-arming on every render.
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  const status = task && task.id === taskId ? task.status : taskId ? "queued" : null;
  const active = status === "queued" || status === "running";
  const unreachable = failures >= MAX_POLL_FAILURES;

  useEffect(() => {
    if (!taskId || !active || unreachable) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
        const body = (await res.json().catch(() => null)) as { task?: Task } | null;
        if (cancelled) return;
        if (!res.ok || !body?.task) {
          setFailures((n) => n + 1);
          return;
        }
        setFailures(0);
        setTask(body.task);
        const terminal = body.task.status !== "queued" && body.task.status !== "running";
        if (terminal && finishedRef.current !== taskId) {
          finishedRef.current = taskId;
          onFinishedRef.current?.(isScanSummary(body.task.result) ? body.task.result : null, body.task.status);
        }
      } catch {
        // Network blip: counted, retried on the next tick, surfaced after ten.
        if (!cancelled) setFailures((n) => n + 1);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, active, unreachable]);

  const start = useCallback(async () => {
    if (starting || active) return;
    setStarting(true);
    setStartError(null);
    setFailures(0);
    try {
      const res = await fetch("/api/jobseeker/scan", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { taskId?: string; code?: string } | null;
      if (!res.ok || !body?.taskId) {
        setStartError({ code: body?.code ?? null });
        return;
      }
      setTask(null);
      setTaskId(body.taskId);
    } catch {
      setStartError({ code: null });
    } finally {
      setStarting(false);
    }
  }, [starting, active]);

  return {
    taskId,
    status,
    active,
    progressMsg: task?.progressMsg ?? null,
    progressDone: task?.progressDone ?? 0,
    progressTotal: task?.progressTotal ?? 0,
    // The task runner's own stored diagnostic, passed through unchanged inside a
    // localized sentence (no code to resolve): a ternary, not a coalesce over a
    // localized fallback (the shape use-error-message.ts's guard hunts for).
    error: task ? task.error : null,
    summary: isScanSummary(task?.result) ? task.result : null,
    unreachable,
    startError,
    starting,
    start,
  };
}
