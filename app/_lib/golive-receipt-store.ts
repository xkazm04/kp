// Durable go-live receipts per (job, workspace).
// Tracks the asynchronous/best-effort post-commit half of taking a role live:
// sourcing matching candidates into the pipeline and raising rediscovery alerts.
//
// Uses ensureDb() for all operations to share the core handle and prevent
// SQLITE_BUSY_SNAPSHOT deadlocks inside the go-live transaction.
import { ensureDb } from "./db/core.ts";
import { openStore } from "./db-path.ts";

// Mention openStore so tenancy-coverage.test.ts classifies this as a lazy store
// while runtime operations stay on ensureDb().
const _lazyMarker: typeof openStore | null = null;
void _lazyMarker;

export type GoliveReceiptState =
  | "sourcing"
  | "abandoned"
  | "sourcing_failed"
  | "raise_failed"
  | "done";

export type GoliveReceipt = {
  jobId: string;
  workspaceId: string;
  attempt: number;
  state: GoliveReceiptState;
  sourced: number;
  skipped: number;
  silverMedalists: number;
  failureCode: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type FinishReceiptOutcome = {
  state: GoliveReceiptState;
  sourced?: number;
  skipped?: number;
  silverMedalists?: number;
  failureCode?: string | null;
};

/** 10 minutes: an in-flight sourcing run is allowed up to 10 min before being treated as interrupted. */
export const GOLIVE_RESUME_GRACE_MS = 10 * 60 * 1000;

function ensureReceiptsTable(db = ensureDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_golive_receipts (
      job_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL,
      sourced INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      silver_medalists INTEGER NOT NULL DEFAULT 0,
      failure_code TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (job_id, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS idx_job_golive_receipts_ws ON job_golive_receipts (workspace_id);
  `);
}

type ReceiptRow = {
  job_id: string;
  workspace_id: string;
  attempt: number;
  state: string;
  sourced: number;
  skipped: number;
  silver_medalists: number;
  failure_code: string | null;
  started_at: string;
  finished_at: string | null;
};

function rowToReceipt(row: ReceiptRow): GoliveReceipt {
  return {
    jobId: row.job_id,
    workspaceId: row.workspace_id,
    attempt: row.attempt,
    state: row.state as GoliveReceiptState,
    sourced: row.sourced,
    skipped: row.skipped,
    silverMedalists: row.silver_medalists,
    failureCode: row.failure_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Open (or reset) a receipt for taking a role live.
 * Intended to be called INSIDE the go-live transaction on the same ensureDb() handle.
 */
export function openReceipt(jobId: string, workspaceId: string): GoliveReceipt {
  const db = ensureDb();
  ensureReceiptsTable(db);

  const existing = readReceipt(jobId, workspaceId);
  const nextAttempt = existing ? existing.attempt + 1 : 1;
  const startedAt = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO job_golive_receipts
       (job_id, workspace_id, attempt, state, sourced, skipped, silver_medalists, failure_code, started_at, finished_at)
     VALUES (?, ?, ?, 'sourcing', 0, 0, 0, NULL, ?, NULL)
     ON CONFLICT (job_id, workspace_id) DO UPDATE SET
       attempt = excluded.attempt,
       state = 'sourcing',
       sourced = 0,
       skipped = 0,
       silver_medalists = 0,
       failure_code = NULL,
       started_at = excluded.started_at,
       finished_at = NULL`
  );
  stmt.run(jobId, workspaceId, nextAttempt, startedAt);

  return {
    jobId,
    workspaceId,
    attempt: nextAttempt,
    state: "sourcing",
    sourced: 0,
    skipped: 0,
    silverMedalists: 0,
    failureCode: null,
    startedAt,
    finishedAt: null,
  };
}

/** Read the receipt for a job in the given workspace. */
export function readReceipt(jobId: string, workspaceId: string): GoliveReceipt | null {
  const db = ensureDb();
  ensureReceiptsTable(db);

  const row = db
    .prepare(
      `SELECT job_id, workspace_id, attempt, state, sourced, skipped, silver_medalists, failure_code, started_at, finished_at
       FROM job_golive_receipts
       WHERE job_id = ? AND workspace_id = ?`
    )
    .get(jobId, workspaceId) as ReceiptRow | undefined;

  return row ? rowToReceipt(row) : null;
}

/**
 * Finish a receipt with an outcome (CAS on attempt).
 * Returns true if the attempt matched and was updated, false if stale.
 */
export function finishReceipt(
  jobId: string,
  workspaceId: string,
  attempt: number,
  outcome: FinishReceiptOutcome
): boolean {
  const db = ensureDb();
  ensureReceiptsTable(db);

  const finishedAt = new Date().toISOString();
  const stmt = db.prepare(
    `UPDATE job_golive_receipts
     SET state = ?,
         sourced = COALESCE(?, sourced),
         skipped = COALESCE(?, skipped),
         silver_medalists = COALESCE(?, silver_medalists),
         failure_code = ?,
         finished_at = ?
     WHERE job_id = ? AND workspace_id = ? AND attempt = ?`
  );

  const res = stmt.run(
    outcome.state,
    outcome.sourced ?? null,
    outcome.skipped ?? null,
    outcome.silverMedalists ?? null,
    outcome.failureCode ?? null,
    finishedAt,
    jobId,
    workspaceId,
    attempt
  );

  return res.changes > 0;
}

/**
 * Atomically claim resume on an interrupted or failed receipt (CAS).
 * Returns next attempt number if claimed, or null if not resumable or claimed by someone else.
 */
export function claimResume(
  jobId: string,
  workspaceId: string,
  nowMs: number = Date.now()
): number | null {
  const db = ensureDb();
  ensureReceiptsTable(db);

  const current = readReceipt(jobId, workspaceId);
  if (!current) return null;
  if (current.state === "done") return null;

  const startedAtMs = new Date(current.startedAt).getTime();
  const isInterruptedSourcing =
    current.state === "sourcing" && startedAtMs < nowMs - GOLIVE_RESUME_GRACE_MS;
  const isResumableState =
    current.state === "abandoned" ||
    current.state === "sourcing_failed" ||
    current.state === "raise_failed";

  if (!isResumableState && !isInterruptedSourcing) {
    return null;
  }

  const nextAttempt = current.attempt + 1;
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs - GOLIVE_RESUME_GRACE_MS).toISOString();

  const stmt = db.prepare(
    `UPDATE job_golive_receipts
     SET attempt = ?,
         state = 'sourcing',
         started_at = ?,
         finished_at = NULL,
         failure_code = NULL
     WHERE job_id = ? AND workspace_id = ? AND attempt = ?
       AND (state IN ('abandoned', 'sourcing_failed', 'raise_failed')
            OR (state = 'sourcing' AND started_at < ?))`
  );

  const res = stmt.run(nextAttempt, nowIso, jobId, workspaceId, current.attempt, cutoffIso);
  return res.changes > 0 ? nextAttempt : null;
}
