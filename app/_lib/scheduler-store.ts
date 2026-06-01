import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Direction #5 — durable scheduler state for the automation clock. Isolated
// connection (job-ingest.ts / offers-store.ts pattern) so we don't touch the
// fork-churned db.ts. Two tables: `scheduler` holds one row per job (enabled,
// cadence, last/next run) so the clock survives restarts and never double-fires;
// `scheduler_runs` is the durable run log surfaced in the UI.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

export const POLICY_JOB = "policy_pass";
const DEFAULT_INTERVAL_MIN = 15;

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // The policy pass writes pipeline_entries/pipeline_events on db.ts's separate
  // connection to the same kp.sqlite file while we write scheduler/scheduler_runs.
  // Without this, claimDueRun()/recordRun() throw SQLITE_BUSY the moment the pass
  // is mid-write — and since claimDueRun already advanced next_due_at, the window
  // is silently skipped. Wait briefly instead of crashing.
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS scheduler (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL DEFAULT 15,
      last_run_at TEXT,
      next_due_at TEXT,
      last_summary_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'clock',
      status TEXT NOT NULL,
      summary_json TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started ON scheduler_runs (started_at DESC);
  `);
  _db = d;
  return d;
}

export type Schedule = {
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextDueAt: string | null;
  lastSummary: unknown;
  updatedAt: string;
};

function rowToSchedule(r: Record<string, unknown>): Schedule {
  let lastSummary: unknown = null;
  try {
    lastSummary = r.last_summary_json ? JSON.parse(r.last_summary_json as string) : null;
  } catch {
    lastSummary = null;
  }
  return {
    name: r.name as string,
    enabled: Boolean(r.enabled),
    intervalMinutes: r.interval_minutes as number,
    lastRunAt: (r.last_run_at as string) ?? null,
    nextDueAt: (r.next_due_at as string) ?? null,
    lastSummary,
    updatedAt: r.updated_at as string,
  };
}

/** Create the job row once if absent. Default OFF — opt-in via the UI toggle or
 *  AUTOMATION_SCHEDULER_AUTOSTART=1 (so nothing auto-mutates data unexpectedly). */
export function ensureSchedule(name = POLICY_JOB): Schedule {
  const d = db();
  const existing = d.prepare(`SELECT * FROM scheduler WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (existing) return rowToSchedule(existing);
  const now = new Date().toISOString();
  const autostart = process.env.AUTOMATION_SCHEDULER_AUTOSTART === "1" ? 1 : 0;
  d.prepare(
    `INSERT INTO scheduler (name, enabled, interval_minutes, last_run_at, next_due_at, last_summary_json, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?)`
  ).run(name, autostart, DEFAULT_INTERVAL_MIN, autostart ? now : null, now);
  return rowToSchedule(d.prepare(`SELECT * FROM scheduler WHERE name = ?`).get(name) as Record<string, unknown>);
}

export function getSchedule(name = POLICY_JOB): Schedule {
  return ensureSchedule(name);
}

export function setEnabled(name: string, enabled: boolean): Schedule {
  const d = db();
  ensureSchedule(name);
  const now = new Date().toISOString();
  // Enabling makes it due immediately; disabling clears the next-due time.
  d.prepare(`UPDATE scheduler SET enabled = ?, next_due_at = ?, updated_at = ? WHERE name = ?`).run(
    enabled ? 1 : 0,
    enabled ? now : null,
    now,
    name
  );
  return getSchedule(name);
}

export function setIntervalMinutes(name: string, minutes: number): Schedule {
  const d = db();
  ensureSchedule(name);
  const clamped = Math.max(1, Math.min(1440, Math.round(minutes)));
  d.prepare(`UPDATE scheduler SET interval_minutes = ?, updated_at = ? WHERE name = ?`).run(clamped, new Date().toISOString(), name);
  return getSchedule(name);
}

/**
 * Atomically claim a due run. Returns true to exactly ONE caller when the job is
 * enabled and now >= next_due_at; advances next_due_at by the interval in the
 * same UPDATE so a restart or a second process can't double-fire. Pure clock —
 * does not run the pass.
 */
export function claimDueRun(name = POLICY_JOB): boolean {
  const d = db();
  ensureSchedule(name);
  const now = new Date().toISOString();
  const sched = getSchedule(name);
  if (!sched.enabled) return false;
  const next = new Date(Date.now() + sched.intervalMinutes * 60_000).toISOString();
  const res = d
    .prepare(
      `UPDATE scheduler SET last_run_at = ?, next_due_at = ?, updated_at = ?
       WHERE name = ? AND enabled = 1 AND (next_due_at IS NULL OR next_due_at <= ?)`
    )
    .run(now, next, now, name, now);
  return res.changes === 1;
}

export function recordRun(input: {
  job?: string;
  trigger?: string;
  status: "ok" | "error";
  summary?: unknown;
  error?: string;
  startedAt: string;
}): void {
  const d = db();
  const name = input.job ?? POLICY_JOB;
  d.prepare(
    `INSERT INTO scheduler_runs (job, trigger, status, summary_json, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    input.trigger ?? "clock",
    input.status,
    input.summary != null ? JSON.stringify(input.summary) : null,
    input.error ?? null,
    input.startedAt,
    new Date().toISOString()
  );
  if (input.status === "ok" && input.summary != null) {
    d.prepare(`UPDATE scheduler SET last_summary_json = ?, updated_at = ? WHERE name = ?`).run(
      JSON.stringify(input.summary),
      new Date().toISOString(),
      name
    );
  }
}

export type SchedulerRun = {
  id: number;
  job: string;
  trigger: string;
  status: string;
  summary: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export function listRuns(limit = 10, job = POLICY_JOB): SchedulerRun[] {
  const rows = db()
    .prepare(`SELECT * FROM scheduler_runs WHERE job = ? ORDER BY started_at DESC LIMIT ?`)
    .all(job, limit) as Record<string, unknown>[];
  return rows.map((r) => {
    let summary: unknown = null;
    try {
      summary = r.summary_json ? JSON.parse(r.summary_json as string) : null;
    } catch {
      summary = null;
    }
    return {
      id: r.id as number,
      job: r.job as string,
      trigger: r.trigger as string,
      status: r.status as string,
      summary,
      error: (r.error as string) ?? null,
      startedAt: r.started_at as string,
      finishedAt: (r.finished_at as string) ?? null,
    };
  });
}
