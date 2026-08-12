import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Tenancy (E0 Phase 1). The background-task queue is split: the RECRUITER-facing reads
// (the /api/tasks poll + history pager) and dedup + create are workspace-scoped so a
// user sees only their team's runs; the RUNNER (by globally-unique task id) and the
// GLOBAL boot-recovery / readiness probes are deliberately cross-tenant system ops — the
// one task runner drains every team's queue and boot must recover all orphans. The
// `-- tenancy:global` marker tags those system queries for the source-guard test.

/** Tasks still in flight, for the readiness probe (global system health). */
export function countActiveTasks(): { running: number; queued: number } {
  const db = ensureDb();
  const running = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status='running' -- tenancy:global`).get() as { n: number }).n;
  const queued = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status='queued' -- tenancy:global`).get() as { n: number }).n;
  return { running, queued };
}

/** Row counts for core tables, for the readiness probe. Table names are a fixed allow-list. */
export function coreTableCounts(): Record<string, number> {
  const db = ensureDb();
  const out: Record<string, number> = {};
  for (const t of ["jobs", "profiles", "pipeline_entries", "analyses", "tasks"]) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}

// ---- Background tasks queue (Phase 17) ------------------------------------

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

export type TaskRecord = {
  id: string;
  kind: string;
  /** The team that enqueued the task (P1) — the runner threads it to the handler so a
   *  background job scopes to the same tenant as the recruiter who started it. */
  workspaceId: string;
  dedupeKey: string | null;
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
  /** When the finished outcome was acknowledged in the Background-tasks view;
   *  null = unread (the TasksIndicator badge counts these). */
  seenAt: string | null;
};

type TaskRow = {
  id: string;
  kind: string;
  workspace_id: string;
  dedupe_key: string | null;
  label: string | null;
  status: string;
  params_json: string | null;
  result_json: string | null;
  error: string | null;
  progress_done: number;
  progress_total: number;
  progress_msg: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  seen_at: string | null;
};

function rowToTask(r: TaskRow): TaskRecord {
  return {
    id: r.id,
    kind: r.kind,
    workspaceId: r.workspace_id ?? "workspace",
    dedupeKey: r.dedupe_key,
    label: r.label,
    status: r.status as TaskStatus,
    params: safeRowParse(r.params_json, "task.params", r.id),
    result: safeRowParse(r.result_json, "task.result", r.id),
    error: r.error,
    progressDone: r.progress_done ?? 0,
    progressTotal: r.progress_total ?? 0,
    progressMsg: r.progress_msg,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    seenAt: r.seen_at,
  };
}

// The live Background-tasks poll (GET /api/tasks fires every 2s while a task is
// active) and the history pager render only a task's status, label, progress and
// timing — never its result or params. A finished analyze/group_eval row carries
// multi-MB result_json/params_json, so SELECT * + re-parsing them for up to 60
// rows on every tick turns a lightweight status poll into a recurring multi-MB
// transfer and JSON re-parse, shipped to every connected client. List queries
// therefore project ONLY these light columns and leave result/params null; the
// full blob is fetched on demand for ONE row via getTask (GET /api/tasks/[id]).
const TASK_LITE_COLUMNS =
  "id, kind, workspace_id, dedupe_key, label, status, error, progress_done, progress_total, progress_msg, created_at, started_at, finished_at, seen_at";

type TaskLiteRow = Omit<TaskRow, "params_json" | "result_json">;

function rowToTaskLite(r: TaskLiteRow): TaskRecord {
  return {
    id: r.id,
    kind: r.kind,
    workspaceId: r.workspace_id ?? "workspace",
    dedupeKey: r.dedupe_key,
    label: r.label,
    status: r.status as TaskStatus,
    params: null, // omitted from list payloads — fetch the full task by id
    result: null, // omitted from list payloads — fetch the full task by id
    error: r.error,
    progressDone: r.progress_done ?? 0,
    progressTotal: r.progress_total ?? 0,
    progressMsg: r.progress_msg,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    seenAt: r.seen_at,
  };
}

/** Acknowledge finished tasks (read/unread): stamp seen_at on the given TERMINAL
 *  rows, scoped to the caller's workspace. Active rows are excluded so a finish
 *  that lands after the ack still counts as unread. Returns rows stamped. */
export function markTasksSeen(ids: string[], workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  if (ids.length === 0) return 0;
  const db = ensureDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE tasks SET seen_at = ? WHERE id = ? AND workspace_id = ? AND seen_at IS NULL AND status NOT IN ('queued','running')`
  );
  let changed = 0;
  const tx = db.transaction((batch: string[]) => {
    for (const id of batch) changed += stmt.run(now, id, workspaceId).changes as number;
  });
  tx(ids);
  return changed;
}

export function createTask(
  id: string,
  kind: string,
  dedupeKey: string | null,
  label: string | null,
  params: unknown,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): TaskRecord {
  const db = ensureDb();
  try {
    db.prepare(
      `INSERT INTO tasks (id, kind, dedupe_key, label, status, params_json, created_at, workspace_id) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`
    ).run(id, kind, dedupeKey, label, JSON.stringify(params ?? null), new Date().toISOString(), workspaceId);
  } catch (e) {
    // uq_tasks_active_dedupe (when present) makes dedup atomic across connections: a
    // concurrent writer already started an active task with this key, so return that
    // instead of inserting a duplicate. Re-throw anything that isn't the collision.
    // NOTE: the unique index is on dedupe_key alone — dedup within a workspace here, but
    // the index must widen to (workspace_id, dedupe_key) before KP_MULTI_WORKSPACE so two
    // teams' identical keys can't collide (tracked with the other pre-flip schema notes).
    if (dedupeKey && (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      const existing = getActiveTaskByDedupe(dedupeKey, workspaceId);
      if (existing) return existing;
    }
    throw e;
  }
  return getTask(id)!;
}

export function getTask(id: string): TaskRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  return r ? rowToTask(r) : null;
}

/** Dedup: an in-flight task with the same key (in this workspace) is reused instead of
 *  starting a duplicate. Scoped so two teams' identical dedupe keys never coalesce. */
export function getActiveTaskByDedupe(dedupeKey: string, workspaceId: string = DEFAULT_WORKSPACE_ID): TaskRecord | null {
  const db = ensureDb();
  const r = db
    .prepare(`SELECT * FROM tasks WHERE dedupe_key = ? AND status IN ('queued','running') AND workspace_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(dedupeKey, workspaceId) as TaskRow | undefined;
  return r ? rowToTask(r) : null;
}

// The live Background-tasks view: every active (queued/running) task regardless
// of age — a long run started days ago must stay visible — plus tasks that
// finished on/after `sinceIso`. Older finished tasks are excluded here and paged
// in on demand via listTaskHistory, so the polled payload stays bounded. Result
// and params are projected out (see TASK_LITE_COLUMNS) so this hot poll never
// re-ships multi-MB blobs; callers fetch the full task by id when they need it.
export function listRecentTasks(sinceIso: string, limit = 60, workspaceId: string = DEFAULT_WORKSPACE_ID): TaskRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT ${TASK_LITE_COLUMNS} FROM tasks
       WHERE workspace_id = @workspace
         AND (status IN ('queued','running')
          OR COALESCE(finished_at, created_at) >= @since)
       ORDER BY (CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END),
                CASE WHEN status IN ('queued','running') THEN created_at END ASC,
                finished_at DESC
       LIMIT @limit`
    )
    .all({ since: sinceIso, limit, workspace: workspaceId }) as TaskLiteRow[];
  return rows.map(rowToTaskLite);
}

// Finished tasks older than `beforeIso`, newest-first, offset-paged — the
// complement of listRecentTasks. Powers the on-demand history table so the full
// (potentially huge) trail is never loaded at once. The `< before` here and the
// `>= since` above share one cutoff at the call site, so no task is dropped
// between the two windows or shown in both.
// DATA6 — optional kind/status narrowing for the paged history. The clauses are
// fixed strings chosen by presence (never interpolated values — both filters
// bind as parameters), so the prepared-statement shape stays injection-safe.
export type TaskHistoryFilter = { kind?: string; status?: string };

function taskHistoryClauses(filter?: TaskHistoryFilter): { sql: string; params: Record<string, string> } {
  let sql = "";
  const params: Record<string, string> = {};
  if (filter?.kind) {
    sql += " AND kind = @kind";
    params.kind = filter.kind;
  }
  if (filter?.status) {
    sql += " AND status = @status";
    params.status = filter.status;
  }
  return { sql, params };
}

export function listTaskHistory(
  beforeIso: string,
  limit: number,
  offset: number,
  filter?: TaskHistoryFilter,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): TaskRecord[] {
  const db = ensureDb();
  const { sql, params } = taskHistoryClauses(filter);
  const rows = db
    .prepare(
      `SELECT ${TASK_LITE_COLUMNS} FROM tasks
       WHERE workspace_id = @workspace
         AND status NOT IN ('queued','running')
         AND COALESCE(finished_at, created_at) < @before${sql}
       ORDER BY COALESCE(finished_at, created_at) DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ before: beforeIso, limit, offset, workspace: workspaceId, ...params }) as TaskLiteRow[];
  return rows.map(rowToTaskLite);
}

export function countTaskHistory(beforeIso: string, filter?: TaskHistoryFilter, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const db = ensureDb();
  const { sql, params } = taskHistoryClauses(filter);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE workspace_id = @workspace
         AND status NOT IN ('queued','running')
         AND COALESCE(finished_at, created_at) < @before${sql}`
    )
    .get({ before: beforeIso, workspace: workspaceId, ...params }) as { n: number };
  return row.n;
}

export function markTaskRunning(id: string): void {
  const db = ensureDb();
  // Guard on a non-terminal status so a late / recovery-re-enqueued write can't
  // resurrect or restamp a canceled / interrupted / finished task (terminal is final).
  db.prepare(`UPDATE tasks SET status='running', started_at=? WHERE id=? AND status IN ('queued','running')`).run(new Date().toISOString(), id);
}

export function setTaskProgress(id: string, done: number, total: number, msg?: string): void {
  const db = ensureDb();
  // A straggler progress callback from a handler still running after cancel must not
  // write to the terminal row (stale "Screening…" text on a dead task).
  db.prepare(`UPDATE tasks SET progress_done=?, progress_total=?, progress_msg=? WHERE id=? AND status IN ('queued','running')`).run(done, total, msg ?? null, id);
}

// A task's result is arbitrary handler output, so JSON.stringify can throw (a
// circular reference) or quietly return undefined (a function/symbol-valued root).
// finishTask runs inside runOne's SUCCESS path, so an unguarded throw there is
// caught and re-records a genuinely succeeded — often costly — run as 'failed',
// dropping its output. Degrade a non-serializable result to a stored marker and
// preserve the real status instead. undefined (no result passed) still stores NULL.
function serializeResult(result: unknown): string | null {
  if (result === undefined) return null;
  try {
    const json = JSON.stringify(result);
    if (json === undefined) throw new Error("result is not JSON-representable");
    return json;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[db:task.result] unserializable result — stored a marker instead: ${reason}`);
    return JSON.stringify({ __unserializable: true, reason });
  }
}

export function finishTask(id: string, status: TaskStatus, opts: { result?: unknown; error?: string }): void {
  const db = ensureDb();
  db.prepare(`UPDATE tasks SET status=?, result_json=?, error=?, finished_at=? WHERE id=?`).run(
    status,
    serializeResult(opts.result),
    opts.error ?? null,
    new Date().toISOString(),
    id
  );
}

/**
 * On server boot the volatile in-process queue is gone, so any 'running' row was
 * orphaned mid-flight — its handler partially executed and cannot resume, so mark
 * it 'interrupted'. 'queued' rows are deliberately left alone: they never started,
 * ran no side effects, and are re-enqueued by the task runner (see listQueuedTaskIds)
 * instead of being silently abandoned. Returns the number of rows interrupted.
 */
export function interruptStaleTasks(): number {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE tasks SET status='interrupted', finished_at=? WHERE status='running' -- tenancy:global`)
    .run(new Date().toISOString());
  return info.changes as number;
}

/**
 * IDs of never-started ('queued') tasks, oldest first. After a restart these are
 * orphans of the volatile in-process queue but ran no handler, so the runner can
 * safely re-enqueue them in submission order rather than dropping the work.
 */
export function listQueuedTaskIds(): string[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT id FROM tasks WHERE status='queued' ORDER BY created_at ASC -- tenancy:global`).all() as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * (id, started_at) for every 'running' row — the wall-clock reaper's input
 * (bug-ui-scan-2026-07-09 #2). Cross-tenant by design: the ONE runner owns every
 * team's live tasks, so a stuck slot must be reclaimable regardless of tenant.
 * The reaper (tasks.ts) decides staleness via task-maintenance.isTaskStale.
 */
export function listRunningTaskTimes(): { id: string; startedAt: string | null }[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT id, started_at FROM tasks WHERE status='running' -- tenancy:global`)
    .all() as { id: string; started_at: string | null }[];
  return rows.map((r) => ({ id: r.id, startedAt: r.started_at }));
}

/**
 * Retention prune (bug-ui-scan-2026-07-09 #3): delete TERMINAL task rows whose
 * effective finish time is before `beforeIso`, reclaiming the unbounded params_json
 * / result_json blobs. The `status NOT IN ('queued','running')` guard makes it
 * impossible to delete an in-flight task no matter the cutoff. Cross-tenant system
 * housekeeping (the runner is global), so tagged `-- tenancy:global`. Returns the
 * number of rows deleted.
 */
export function pruneFinishedTasks(beforeIso: string): number {
  const db = ensureDb();
  const info = db
    .prepare(
      `DELETE FROM tasks
        WHERE status NOT IN ('queued','running')
          AND COALESCE(finished_at, created_at) < ? -- tenancy:global`
    )
    .run(beforeIso);
  return info.changes as number;
}
