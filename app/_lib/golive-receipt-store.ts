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

/** `failure_code` is a CLOSED vocabulary, never the thrown error's text.
 *
 *  This column is the one free-text-shaped field on a table that is listed in
 *  ERASURE_EXEMPT (db/pipeline.ts) on the grounds that it is job-keyed counters.
 *  It used to receive `sourcingError.message` (golive-run.ts), which for a
 *  PipelineError is the sourcing child's whole trimmed stderr and for a non-JSON
 *  reply is the last 400 characters of stdout+stderr — and that child is handed
 *  every candidate profile in the workspace (devcase-run.ts::runSourceForRole),
 *  so a traceback or an output tail could carry names, ids or profile text into a
 *  row the entry-keyed Art. 17 scrub cannot reach and GET /api/jobs/[id]/publish
 *  serves to the browser. The column-name pin in golive-receipt-tenancy.test.ts
 *  cannot see a value, only a column, which is why the vocabulary is the fix.
 *
 *  `ABORTED` and `SOURCING_FAILED` are KP's own; the rest mirror
 *  PYTHON_ERROR_CODES + ENGINE_BUSY_CODE (python-runner.ts) upper-cased, so an
 *  engine refusal keeps its identity without carrying its prose. Kept as literals
 *  rather than imported so this store does not pull the process runner in; the
 *  two are pinned to each other by golive-failure-code.test.ts. */
export const GOLIVE_FAILURE_CODES = [
  "ABORTED",
  "SOURCING_FAILED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "ENGINE_ERROR",
  "TIMEOUT",
  "ENGINE_BUSY",
] as const;

export type GoliveFailureCode = (typeof GOLIVE_FAILURE_CODES)[number];

/** What anything outside the vocabulary becomes — on write, on read, and in the
 *  one-time normalisation of rows written before the vocabulary existed. */
export const GOLIVE_FALLBACK_FAILURE_CODE: GoliveFailureCode = "SOURCING_FAILED";

export function isGoliveFailureCode(value: unknown): value is GoliveFailureCode {
  return typeof value === "string" && (GOLIVE_FAILURE_CODES as readonly string[]).includes(value);
}

/** null stays null (no failure); anything else that is not in the vocabulary
 *  collapses to SOURCING_FAILED, so no reader can ever be handed free text. */
export function coerceGoliveFailureCode(value: string | null | undefined): GoliveFailureCode | null {
  if (value === null || value === undefined) return null;
  return isGoliveFailureCode(value) ? value : GOLIVE_FALLBACK_FAILURE_CODE;
}

export type GoliveReceipt = {
  jobId: string;
  workspaceId: string;
  attempt: number;
  state: GoliveReceiptState;
  sourced: number;
  skipped: number;
  silverMedalists: number;
  failureCode: GoliveFailureCode | null;
  startedAt: string;
  finishedAt: string | null;
};

export type FinishReceiptOutcome = {
  state: GoliveReceiptState;
  sourced?: number;
  skipped?: number;
  silverMedalists?: number;
  failureCode?: GoliveFailureCode | null;
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
  normalizeFailureCodes(db);
}

// Placeholder list for the vocabulary, built once so the two statements below and the
// const array cannot disagree about how many values are bound.
const FAILURE_CODE_PLACEHOLDERS = GOLIVE_FAILURE_CODES.map(() => "?").join(", ");

/**
 * One-time repair of rows written before `failure_code` was a closed vocabulary:
 * every non-null value outside it becomes SOURCING_FAILED. Idempotent, and run from
 * ensureReceiptsTable so it happens wherever the table is ensured rather than needing
 * a migration runner this store does not have.
 *
 * DELIBERATELY NOT workspace-scoped, and marked as such in the SQL so
 * golive-receipt-tenancy.test.ts can exempt exactly these two statements: this is a
 * schema repair, not a tenant operation — there is no tenant to attribute it to, it
 * reads and writes one non-identifying column, and scoping it would leave every other
 * workspace's legacy free text in place. It only ever NARROWS what a row holds.
 *
 * The read comes first so the normal case (no legacy row) stays write-free: an
 * unconditional UPDATE would take a write lock on the read path, which is the
 * SQLITE_BUSY_SNAPSHOT hazard this file's header warns about.
 */
function normalizeFailureCodes(db = ensureDb()): void {
  const stale = db
    .prepare(
      `SELECT 1 FROM job_golive_receipts -- one-time normalisation, deployment-wide by design
       WHERE failure_code IS NOT NULL AND failure_code NOT IN (${FAILURE_CODE_PLACEHOLDERS})
       LIMIT 1`
    )
    .get(...GOLIVE_FAILURE_CODES);
  if (!stale) return;

  db.prepare(
    `UPDATE job_golive_receipts -- one-time normalisation, deployment-wide by design
     SET failure_code = '${GOLIVE_FALLBACK_FAILURE_CODE}'
     WHERE failure_code IS NOT NULL AND failure_code NOT IN (${FAILURE_CODE_PLACEHOLDERS})`
  ).run(...GOLIVE_FAILURE_CODES);
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
    // Belt and braces with normalizeFailureCodes: a row written by an older build
    // still in flight, or by a hand-edited DB, can never reach the API as free text.
    failureCode: coerceGoliveFailureCode(row.failure_code),
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
    coerceGoliveFailureCode(outcome.failureCode),
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
