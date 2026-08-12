// Shared types + the ACTIVE predicate for TasksProvider.tsx, split out so the
// provider stays under the 200-line file cap. Verbatim — same shapes.
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
  /** Read/unread ack for finished outcomes — null = unread (drives the
   *  TasksIndicator unread badge; stamped via POST /api/tasks/seen). */
  seenAt: string | null;
};

export type TasksCtx = {
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
  /** Acknowledge finished tasks (read/unread) — stamps seen_at server-side and
   *  refreshes so the indicator badge clears on the next paint. */
  markSeen: (ids: string[]) => Promise<void>;
};

export const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";

/** Terminal and not yet acknowledged — the rows the unread badge counts. */
export const UNSEEN_DONE = (t: Task) => !ACTIVE(t) && t.seenAt === null;
