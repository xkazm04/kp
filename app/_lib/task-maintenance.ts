// Background-task maintenance decisions (bug-ui-scan-2026-07-09 #2 + #3).
//
// Two invariants the in-process runner (tasks.ts) and store (db/tasks.ts) can't
// express safely on their own:
//
//   #2 A handler that HANGS (an LLM/HTTP call with no timeout, a stuck lock,
//      SQLite contention) never settles, so its `tasks` row stays 'running'
//      forever and never releases one of only MAX_CONCURRENT (=2) slots. Two
//      hangs deadlock the whole queue. A wall-clock budget makes "a stuck handler
//      holds a slot forever" impossible: the runner races each handler against
//      TASK_MAX_RUNTIME_MS, and this module owns the pure "is it stale?" decision
//      the belt-and-suspenders reaper uses for orphaned rows with no live handler.
//
//   #3 Every enqueued task inserts a permanent row carrying params_json + a
//      (possibly multi-MB) result_json, and nothing ever deletes them — the
//      7-day RECENT window is only a READ filter. The table grows without bound.
//      A retention sweep prunes terminal rows past TASK_RETENTION_DAYS while never
//      touching an in-flight (queued/running) row.
//
// Pure + import-free (like scheduler-health.ts) so the node --test runner loads it
// directly and the DB read/write stay OUTSIDE these functions (in tasks.ts /
// db/tasks.ts). node --test can't load tasks.ts (it pulls better-sqlite3), so the
// decisions live here where they're unit-testable.

// ── #2 wall-clock reaper ───────────────────────────────────────────────────

/** Hard ceiling on how long ANY handler may hold a concurrency slot. Generously
 *  above every legitimate handler — spawnPython self-limits at 10 min — so a task
 *  still 'running' past this is wedged, not merely slow. One knob shared by the
 *  in-process watchdog (Promise.race in runOne) and the orphan reaper. */
export const TASK_MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes

/** How often the runner's opportunistic maintenance sweep (reap + prune) may run;
 *  throttled off task submissions rather than an interval, so it never depends on
 *  the (separately monitored, killable) automation clock. */
export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Has a task that entered 'running' at `startedAtIso` exceeded its wall-clock
 * budget as of `nowMs`? Pure — timestamps only.
 *
 * Returns false for a null/absent/unparseable `startedAtIso`: a running row with
 * no start stamp can't be aged, so we never reap on a guess (boot recovery in
 * interruptStaleTasks reclaims genuine orphans instead).
 */
export function isTaskStale(nowMs: number, startedAtIso: string | null | undefined, maxMs: number = TASK_MAX_RUNTIME_MS): boolean {
  if (startedAtIso == null) return false;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedMs)) return false;
  return nowMs - startedMs > maxMs;
}

export type ReapCandidate = { id: string; startedAt: string | null };

/** The ids of 'running' rows that have exceeded the budget — the reaper's pure
 *  selection. Callers still skip any id with a live in-process controller (that
 *  one's own watchdog owns it) before marking the row 'interrupted'. */
export function tasksToReap(rows: readonly ReapCandidate[], nowMs: number, maxMs: number = TASK_MAX_RUNTIME_MS): string[] {
  return rows.filter((r) => isTaskStale(nowMs, r.startedAt, maxMs)).map((r) => r.id);
}

// ── #3 retention / prune ───────────────────────────────────────────────────

/** How long a FINISHED task row is kept before the retention sweep deletes it.
 *  Well past the 7-day live window and any realistic retry horizon; the audit
 *  trail stays useful without the table growing forever. */
export const TASK_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO cutoff for the retention DELETE: rows whose effective finish time is
 *  strictly before this are prunable. Pure so the sweep's boundary is tested. */
export function taskRetentionCutoffIso(nowMs: number, retentionDays: number = TASK_RETENTION_DAYS): string {
  return new Date(nowMs - retentionDays * DAY_MS).toISOString();
}

export type PruneCandidate = { id: string; status: string; finishedAt: string | null; createdAt: string };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "interrupted"]);

/**
 * The ids of TERMINAL task rows older than the retention window — the pure mirror
 * of the store's DELETE. A queued/running row is NEVER returned no matter its age,
 * so an in-flight task can't be pruned out from under the runner. A row with an
 * unparseable effective timestamp is left alone (never guessed into deletion).
 */
export function tasksToPrune(rows: readonly PruneCandidate[], nowMs: number, retentionDays: number = TASK_RETENTION_DAYS): string[] {
  const cutoff = nowMs - retentionDays * DAY_MS;
  return rows
    .filter((r) => {
      if (!TERMINAL.has(r.status)) return false; // in-flight is untouchable
      const effective = Date.parse(r.finishedAt ?? r.createdAt);
      if (!Number.isFinite(effective)) return false;
      return effective < cutoff;
    })
    .map((r) => r.id);
}
