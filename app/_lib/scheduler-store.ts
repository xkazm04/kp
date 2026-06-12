import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";

// Direction #5 — durable scheduler state for the automation clock. Isolated
// connection (job-ingest.ts / offers-store.ts pattern) so we don't touch the
// fork-churned db.ts. Two tables: `scheduler` holds one row per job (enabled,
// cadence, last/next run) so the clock survives restarts and never double-fires;
// `scheduler_runs` is the durable run log surfaced in the UI.

export const POLICY_JOB = "policy_pass";
// AUTO6 — the interview-reminder sweep, registered as a second named job so the
// most candidate-visible automation is no longer the least observable one.
export const REMINDERS_JOB = "reminders";
const DEFAULT_INTERVAL_MIN = 15;
// Reminders historically ran on every 60s heartbeat unconditionally; a 1-minute
// cadence under claimDueRun preserves that timing while making it durable.
const REMINDERS_INTERVAL_MIN = 1;

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
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
  // AUTO2 — per-run decision log (the per-entry action+reason rows the pass
  // used to compute and discard). Additive migration for pre-existing DBs.
  try {
    d.exec(`ALTER TABLE scheduler_runs ADD COLUMN decisions_json TEXT`);
  } catch {
    /* column already exists */
  }
  // AUTO1 — autonomy level for the policy pass's one irreversible, candidate-
  // visible action. NULL (pre-column rows and fresh installs) reads as
  // "approve": the clock computes rejects but queues them on the Decisions
  // gate; a recruiter opts INTO fully autonomous rejections, never out.
  try {
    d.exec(`ALTER TABLE scheduler ADD COLUMN reject_mode TEXT`);
  } catch {
    /* column already exists */
  }
  _db = d;
  return d;
}

export type RejectMode = "auto" | "approve";

export type Schedule = {
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  /** AUTO1 — "approve" (default): the pass queues rejects as rejection_review
   *  approvals; "auto": rejects apply + email unattended (opt-in). */
  rejectMode: RejectMode;
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
    rejectMode: r.reject_mode === "auto" ? "auto" : "approve",
    lastRunAt: (r.last_run_at as string) ?? null,
    nextDueAt: (r.next_due_at as string) ?? null,
    lastSummary,
    updatedAt: r.updated_at as string,
  };
}

/** Create the job row once if absent. Default OFF — opt-in via the UI toggle or
 *  AUTOMATION_SCHEDULER_AUTOSTART=1 (so nothing auto-mutates data unexpectedly).
 *  `defaults` lets a job override that posture at first creation (the reminders
 *  job defaults ON — see ensureReminderJob); an existing row is never altered. */
export function ensureSchedule(
  name = POLICY_JOB,
  defaults?: { enabled?: boolean; intervalMinutes?: number }
): Schedule {
  const d = db();
  const existing = d.prepare(`SELECT * FROM scheduler WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (existing) return rowToSchedule(existing);
  const now = new Date().toISOString();
  const autostart = process.env.AUTOMATION_SCHEDULER_AUTOSTART === "1" ? 1 : 0;
  const enabled = defaults?.enabled != null ? (defaults.enabled ? 1 : 0) : autostart;
  const interval = defaults?.intervalMinutes ?? DEFAULT_INTERVAL_MIN;
  d.prepare(
    `INSERT INTO scheduler (name, enabled, interval_minutes, last_run_at, next_due_at, last_summary_json, updated_at)
     VALUES (?, ?, ?, NULL, ?, NULL, ?)`
  ).run(name, enabled, interval, enabled ? now : null, now);
  return rowToSchedule(d.prepare(`SELECT * FROM scheduler WHERE name = ?`).get(name) as Record<string, unknown>);
}

/** AUTO6 — the reminders job row, created ON at its historical every-minute
 *  cadence so registering it can't silently stop candidate reminders. ALWAYS
 *  reach the row through this (not getSchedule(REMINDERS_JOB)) so whichever
 *  surface touches it first creates it with the right defaults. */
export function ensureReminderJob(): Schedule {
  return ensureSchedule(REMINDERS_JOB, { enabled: true, intervalMinutes: REMINDERS_INTERVAL_MIN });
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

export function setRejectMode(name: string, mode: RejectMode): Schedule {
  const d = db();
  ensureSchedule(name);
  d.prepare(`UPDATE scheduler SET reject_mode = ?, updated_at = ? WHERE name = ?`).run(
    mode === "auto" ? "auto" : "approve",
    new Date().toISOString(),
    name
  );
  return getSchedule(name);
}

export function setIntervalMinutes(name: string, minutes: number): Schedule {
  const d = db();
  ensureSchedule(name);
  // Number.isFinite guard BEFORE the clamp: Math.max/min PROPAGATE NaN rather than clamping
  // it, so a NaN/Infinity minutes would survive as interval_minutes and later throw
  // "Invalid time value" inside claimDueRun (new Date(NaN)), wedging the clock. Non-finite
  // input falls back to the default cadence.
  const clamped = Number.isFinite(minutes) ? Math.max(1, Math.min(1440, Math.round(minutes))) : DEFAULT_INTERVAL_MIN;
  const now = new Date().toISOString();
  const sched = getSchedule(name);
  // Recompute the pending next run so a tightened cadence takes effect predictably
  // instead of waiting up to a full OLD interval for the already-scheduled run to
  // fire. Anchor on the last run (or now if none) + the new interval, clamped to
  // now so we never schedule into the past — shrinking the interval thus fires at
  // most one new-interval away, and may fire immediately if already overdue. Only
  // when enabled: a disabled schedule keeps next_due_at = null.
  let nextDueAt: string | null = sched.nextDueAt;
  if (sched.enabled) {
    const anchorMs = sched.lastRunAt ? Date.parse(sched.lastRunAt) : Date.now();
    nextDueAt = new Date(Math.max(anchorMs + clamped * 60_000, Date.now())).toISOString();
  }
  d.prepare(`UPDATE scheduler SET interval_minutes = ?, next_due_at = ?, updated_at = ? WHERE name = ?`).run(
    clamped,
    nextDueAt,
    now,
    name
  );
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

/**
 * Advance the durable clock after a forced/manual tick. The `force` path in
 * tickScheduler bypasses claimDueRun — the ONLY writer of next_due_at on the run
 * path — so without this the clock stays pointed at an already-due window and the
 * next ~60s heartbeat re-claims and re-runs the same pass. Mirrors claimDueRun's
 * advancement (last_run_at = now, next_due_at = now + interval). No-op when the
 * job is disabled, so a manual "Run now" while off doesn't arm the clock.
 */
export function advanceAfterForcedRun(name = POLICY_JOB): void {
  const d = db();
  ensureSchedule(name);
  const sched = getSchedule(name);
  if (!sched.enabled) return;
  const now = new Date().toISOString();
  const next = new Date(Date.now() + sched.intervalMinutes * 60_000).toISOString();
  d.prepare(`UPDATE scheduler SET last_run_at = ?, next_due_at = ?, updated_at = ? WHERE name = ?`).run(
    now,
    next,
    now,
    name
  );
}

export function recordRun(input: {
  job?: string;
  trigger?: string;
  status: "ok" | "error";
  summary?: unknown;
  // AUTO2 — the pass's per-entry decision rows (action + reason), so "why is
  // this candidate held / why was she rejected" survives past the one run.
  decisions?: unknown;
  error?: string;
  startedAt: string;
}): void {
  const d = db();
  const name = input.job ?? POLICY_JOB;
  d.prepare(
    `INSERT INTO scheduler_runs (job, trigger, status, summary_json, decisions_json, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    input.trigger ?? "clock",
    input.status,
    input.summary != null ? JSON.stringify(input.summary) : null,
    input.decisions != null ? JSON.stringify(input.decisions) : null,
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
  decisions: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export function listRuns(limit = 10, job = POLICY_JOB): SchedulerRun[] {
  const rows = db()
    .prepare(`SELECT * FROM scheduler_runs WHERE job = ? ORDER BY started_at DESC LIMIT ?`)
    .all(job, limit) as Record<string, unknown>[];
  return rows.map((r) => {
    const parse = (raw: unknown): unknown => {
      try {
        return raw ? JSON.parse(raw as string) : null;
      } catch {
        return null;
      }
    };
    return {
      id: r.id as number,
      job: r.job as string,
      trigger: r.trigger as string,
      status: r.status as string,
      summary: parse(r.summary_json),
      decisions: parse(r.decisions_json),
      error: (r.error as string) ?? null,
      startedAt: r.started_at as string,
      finishedAt: (r.finished_at as string) ?? null,
    };
  });
}
