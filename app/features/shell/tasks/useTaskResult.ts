// useTaskResult — watch a task you started through to completion and get its
// full result/params. Split out of TasksProvider.tsx so the provider stays under
// the 200-line file cap; re-exported from there so every existing import path
// (`@/app/features/shell/tasks/TasksProvider`) keeps working unchanged.
//
// The polled list (GET /api/tasks) omits each task's heavy result/params blobs, so
// the common UI pattern "kick off a task, then read its `.result` off the polled
// list once it succeeds" no longer works directly. This hook bridges the gap: it
// tracks `taskId` via the live poll for cheap status/error/progress, and once the
// task reaches a terminal state it fetches the FULL record ONCE from
// GET /api/tasks/[id] and exposes it as `full` (so you read `full.result` /
// `full.params`). A transient fetch failure leaves `full` null and retries on the
// next poll tick. Pass null to watch nothing (e.g. before a task is started).
import { useEffect, useRef, useState } from "react";
import { nextResultFetchAttempts, resultFetchGaveUp } from "@/app/_lib/task-poll-state";
import { useTasks } from "./TasksProvider";
import type { Task, TaskStatus } from "./tasksProviderTypes";

// OO-L2-12 — the give-up counter itself now lives in app/_lib/task-poll-state.ts
// (pure, and pinned by task-poll-state.test.ts: a .tsx-adjacent hook cannot be
// driven by node --test, and "how many silent retries before the spinner gives
// up" is exactly the kind of number that rots unwatched). Re-exported here, and
// from TasksProvider, so every existing import path keeps working.
export { RESULT_FETCH_MAX_ATTEMPTS } from "@/app/_lib/task-poll-state";

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
  /** OO-L2-12 — the task reached a terminal state but its full record could not
   *  be fetched after RESULT_FETCH_MAX_ATTEMPTS tries. Consumers MUST resolve
   *  their busy state and surface an error instead of spinning forever. */
  resultUnavailable: boolean;
} {
  const { tasks, fetchTask } = useTasks();
  const polled = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;
  const status = polled?.status ?? null;
  // NOT the `{ error, code }` API envelope: this is the task runner's own stored
  // diagnostic on the polled record, passed through unchanged (there is no code to
  // resolve and no fallback being skipped here). Written as a ternary so it doesn't
  // read as the coalesce-over-a-localized-fallback anti-pattern the i18n guard hunts
  // for (app/_lib/use-error-message.ts).
  const error = polled ? polled.error : null;
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
  // OO-L2-12 — consecutive failed fetches for the CURRENT id, and the id we gave
  // up on. Before this, a persistently failing GET /api/tasks/[id] retried forever
  // and silently: the task was done server-side while the UI spun "Working…" with
  // no error and no way out.
  const failedAttempts = useRef(0);
  const attemptsFor = useRef<string | null>(null);
  const [gaveUpId, setGaveUpId] = useState<string | null>(null);
  const resultUnavailable = taskId != null && gaveUpId === taskId && full === null;

  useEffect(() => {
    // Fetch the result/params the poll omits, once the task is done. Depending on
    // `polled` lets a transient failure retry on the next poll tick; the `full`,
    // inFlight and give-up guards stop that from looping once the result is in
    // hand — or once it's clearly not coming.
    if (attemptsFor.current !== taskId) {
      attemptsFor.current = taskId;
      failedAttempts.current = 0;
    }
    if (!taskId || !terminal || full || inFlight.current === taskId || gaveUpId === taskId) return;
    inFlight.current = taskId;
    let cancelled = false;
    void fetchTask(taskId).then((t) => {
      if (inFlight.current === taskId) inFlight.current = null;
      if (cancelled) return;
      if (t) {
        failedAttempts.current = nextResultFetchAttempts(failedAttempts.current, true);
        setFetched(t);
      } else if (attemptsFor.current === taskId) {
        failedAttempts.current = nextResultFetchAttempts(failedAttempts.current, false);
        if (resultFetchGaveUp(failedAttempts.current)) setGaveUpId(taskId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, terminal, full, fetchTask, polled, gaveUpId]);

  return {
    status,
    active,
    error,
    progressMsg,
    full,
    loading: terminal && full === null && !resultUnavailable,
    resultUnavailable,
  };
}
