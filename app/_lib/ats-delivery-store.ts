import Database from "better-sqlite3";
import { openStore } from "./db-path.ts";
import { type AtsEventType } from "./ats-webhook.ts";

// P1-5 (reliability) — the durable delivery LEDGER for the outbound ATS webhook.
// Previously a lifecycle dispatch was best-effort fire-and-forget: a receiver 4xx/5xx
// was mis-recorded as delivered, a timeout/network error was only console.error'd, and
// nothing was replayable — so `candidate.hired` could vanish with no operator signal.
//
// This store persists one row per delivery ATTEMPT-SET (event + entry): status,
// attempt count, last HTTP status / error, and a backoff-scheduled next_attempt_at.
// A non-2xx / network failure becomes a `failed` row that the retry sweep
// (retryDueAtsDeliveries in ats-egress) picks up; after MAX_ATTEMPTS it stays `failed`
// with next_attempt_at NULL — a terminal DEAD-LETTER that is still operator-visible
// (GET /api/ats/deliveries) and force-retryable. Its own isolated connection on the
// shared kp.sqlite (ats-config-store / offers-store pattern).

/** After this many attempts a failed delivery stops auto-retrying and becomes a
 *  terminal dead-letter (still visible; a manual/forced replay can revive it). */
export const MAX_ATTEMPTS = 6;
/** First retry delay; doubles each attempt (1m, 2m, 4m, 8m, 16m, …). */
export const BASE_BACKOFF_MS = 60_000;

export type AtsDeliveryStatus = "pending" | "delivered" | "failed";

export type AtsDeliveryRow = {
  id: number;
  event: AtsEventType;
  entryId: string;
  status: AtsDeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  /** When the next retry becomes due (ISO), or null when delivered / dead-lettered. */
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type RawRow = {
  id: number;
  event: string;
  entry_id: string;
  status: string;
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS ats_delivery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_status INTEGER,
      last_error TEXT,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ats_delivery_due ON ats_delivery (status, next_attempt_at);
  `);
  _db = d;
  return d;
}

function mapRow(r: RawRow): AtsDeliveryRow {
  return {
    id: r.id,
    event: r.event as AtsEventType,
    entryId: r.entry_id,
    status: r.status as AtsDeliveryStatus,
    attempts: r.attempts,
    lastStatus: r.last_status,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Exponential backoff for the Nth attempt (1-based): attempt 1 → BASE, 2 → 2×BASE… */
function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
}

/** Open a ledger row for a delivery about to be attempted (status `pending`,
 *  0 attempts). Returns its id so the caller can finalize the outcome. */
export function recordAtsDeliveryStart(event: AtsEventType, entryId: string): number {
  const now = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO ats_delivery (event, entry_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`
    )
    .run(event, entryId, now, now);
  return Number(info.lastInsertRowid);
}

export type DeliveryOutcome = { delivered: boolean; status?: number; reason?: string };

/** Record the outcome of ONE attempt against a ledger row. Success → `delivered`,
 *  no further retries. Failure → `failed` with attempts incremented and a backoff
 *  next_attempt_at, UNLESS MAX_ATTEMPTS is reached, in which case it becomes a
 *  terminal dead-letter (next_attempt_at NULL). No-op if the row is gone. */
export function finalizeAtsDelivery(id: number, outcome: DeliveryOutcome, now: Date = new Date()): void {
  const row = db().prepare(`SELECT attempts FROM ats_delivery WHERE id = ?`).get(id) as { attempts: number } | undefined;
  if (!row) return;
  const attempts = row.attempts + 1;
  const iso = now.toISOString();
  if (outcome.delivered) {
    db()
      .prepare(
        `UPDATE ats_delivery SET status='delivered', attempts=?, last_status=?, last_error=NULL,
           next_attempt_at=NULL, updated_at=? WHERE id=?`
      )
      .run(attempts, outcome.status ?? null, iso, id);
    return;
  }
  const retryable = attempts < MAX_ATTEMPTS;
  const nextAt = retryable ? new Date(now.getTime() + backoffMs(attempts)).toISOString() : null;
  db()
    .prepare(
      `UPDATE ats_delivery SET status='failed', attempts=?, last_status=?, last_error=?,
         next_attempt_at=?, updated_at=? WHERE id=?`
    )
    .run(attempts, outcome.status ?? null, (outcome.reason ?? "delivery failed").slice(0, 300), nextAt, iso, id);
}

/** Failed deliveries whose backoff window has elapsed and that still have retry
 *  budget — the work list for the retry sweep. Ordered oldest-due first. */
export function listDueAtsDeliveries(nowIso: string = new Date().toISOString(), limit = 50): AtsDeliveryRow[] {
  return (
    db()
      .prepare(
        `SELECT * FROM ats_delivery
         WHERE status='failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? AND attempts < ?
         ORDER BY next_attempt_at ASC LIMIT ?`
      )
      .all(nowIso, MAX_ATTEMPTS, limit) as RawRow[]
  ).map(mapRow);
}

/** Recent deliveries for the operator view (newest first). */
export function listAtsDeliveries(limit = 100): AtsDeliveryRow[] {
  return (db().prepare(`SELECT * FROM ats_delivery ORDER BY id DESC LIMIT ?`).all(limit) as RawRow[]).map(mapRow);
}

export function getAtsDelivery(id: number): AtsDeliveryRow | null {
  const r = db().prepare(`SELECT * FROM ats_delivery WHERE id = ?`).get(id) as RawRow | undefined;
  return r ? mapRow(r) : null;
}
