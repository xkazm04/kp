import Database from "better-sqlite3";
import { openStore } from "./db-path.ts";
import { isAtsEvent, type AtsEventType } from "./ats-webhook.ts";

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

/** How long a TERMINAL ledger row is kept before the retention sweep drops it. The
 *  ledger is operational telemetry — "did the hire reach the HRIS, and if not why" — and
 *  every row names a candidate's pipeline entry, so it is also personal data with no
 *  reason to outlive the question it answers. Nothing deleted here is provenance: the
 *  decision chain (decision-record-store) and the pipeline timeline are the record. */
export const DELIVERY_RETENTION_DAYS = 90;

/** The closed status vocabulary — literal array + derived union + runtime guard, the
 *  house shape for a value that round-trips through a TEXT column (tabs.ts,
 *  i18n/locales.ts). `mapRow` used to CAST the column, so a hand-edited or
 *  future-version row handed every reader a status outside the type. */
export const ATS_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type AtsDeliveryStatus = (typeof ATS_DELIVERY_STATUSES)[number];

export function isAtsDeliveryStatus(v: unknown): v is AtsDeliveryStatus {
  return typeof v === "string" && (ATS_DELIVERY_STATUSES as readonly string[]).includes(v);
}

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
  // An unreadable status is not a reason to hand a caller a lie in the right shape.
  // `failed` is the fail-CLOSED answer: it keeps the row visible in the operator view
  // and (with next_attempt_at as stored) does not invent retry budget the row never had.
  if (!isAtsDeliveryStatus(r.status)) {
    console.error(`[ats] delivery row #${r.id} carries an unknown status ${JSON.stringify(r.status)} — read as "failed"`);
  }
  if (!isAtsEvent(r.event)) {
    console.error(`[ats] delivery row #${r.id} carries an unknown event ${JSON.stringify(r.event)} — it can never be re-delivered`);
  }
  return {
    id: r.id,
    event: r.event as AtsEventType,
    entryId: r.entry_id,
    status: isAtsDeliveryStatus(r.status) ? r.status : "failed",
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
export function recordAtsDeliveryStart(event: AtsEventType, entryId: string, at: Date = new Date()): number {
  const now = at.toISOString();
  const info = db()
    .prepare(
      `INSERT INTO ats_delivery (event, entry_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`
    )
    .run(event, entryId, now, now);
  return Number(info.lastInsertRowid);
}

export type DeliveryOutcome = {
  delivered: boolean;
  status?: number;
  reason?: string;
  /** A refusal that will never change its mind (the consent gate). Recorded as failed
   *  and DEAD-LETTERED immediately: scheduling six retries of a decision would spend the
   *  ladder pretending a permanent answer might become a different one. */
  terminal?: boolean;
};

/** CLAIM a due delivery for one sweep. Two sweeps (an operator's POST /api/ats/deliveries
 *  and the cron beside it) both read the same due list, and before this both DELIVERED it
 *  — a duplicate hire in the customer's HRIS, which is exactly the outcome the ledger
 *  exists to prevent. The claim is a compare-and-swap on the row's (status, attempts) —
 *  `.changes === 1` means this caller owns the attempt and everyone else must skip.
 *  Flipping the row to `pending` also takes it out of the due list for the duration. */
export function claimAtsDelivery(id: number, expectedAttempts: number, now: Date = new Date()): boolean {
  const res = db()
    .prepare(
      `UPDATE ats_delivery SET status='pending', next_attempt_at=NULL, updated_at=?
       WHERE id=? AND status='failed' AND attempts=?`
    )
    .run(now.toISOString(), id, expectedAttempts);
  return res.changes === 1;
}

/** Record the outcome of ONE attempt against a ledger row. Success → `delivered`,
 *  no further retries. Failure → `failed` with attempts incremented and a backoff
 *  next_attempt_at, UNLESS MAX_ATTEMPTS is reached or the outcome is `terminal`, in
 *  which case it becomes a dead-letter (next_attempt_at NULL). No-op if the row is gone.
 *
 *  Returns whether it wrote. The read→compute→write here re-asserts the attempt count it
 *  read in the UPDATE's WHERE and skips on `changes === 0` (.claude/CLAUDE.md — "a
 *  read→compute→write either locks or re-checks"): the SELECT and the UPDATE used to be
 *  keyed by id alone, so two finalizers racing on one row each read attempts=1 and both
 *  wrote attempts=2 — one attempt vanished from the count and the later writer's backoff
 *  overwrote the earlier one's. */
export function finalizeAtsDelivery(id: number, outcome: DeliveryOutcome, now: Date = new Date()): boolean {
  const row = db().prepare(`SELECT attempts FROM ats_delivery WHERE id = ?`).get(id) as { attempts: number } | undefined;
  if (!row) return false;
  const attempts = row.attempts + 1;
  const iso = now.toISOString();
  if (outcome.delivered) {
    const res = db()
      .prepare(
        `UPDATE ats_delivery SET status='delivered', attempts=?, last_status=?, last_error=NULL,
           next_attempt_at=NULL, updated_at=? WHERE id=? AND attempts=?`
      )
      .run(attempts, outcome.status ?? null, iso, id, row.attempts);
    return res.changes === 1;
  }
  const retryable = attempts < MAX_ATTEMPTS && !outcome.terminal;
  const nextAt = retryable ? new Date(now.getTime() + backoffMs(attempts)).toISOString() : null;
  const res = db()
    .prepare(
      `UPDATE ats_delivery SET status='failed', attempts=?, last_status=?, last_error=?,
         next_attempt_at=?, updated_at=? WHERE id=? AND attempts=?`
    )
    .run(attempts, outcome.status ?? null, (outcome.reason ?? "delivery failed").slice(0, 300), nextAt, iso, id, row.attempts);
  return res.changes === 1;
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

/** Retention sweep: drop TERMINAL ledger rows older than the stated window. The table
 *  had no DELETE anywhere in the tree, so every attempt of every mirrored hire accrued
 *  forever, each naming a pipeline entry.
 *
 *  A row is terminal when it is `delivered`, or `failed` with no next attempt scheduled
 *  (dead-lettered). `next_attempt_at IS NULL` is the guard that keeps a still-retryable
 *  failure — however old — out of this: a delivery that is going to be retried is live
 *  work, not history. `pending` rows are never swept; an in-flight attempt owns its row.
 *  Idempotent, best-effort, returns how many it dropped. */
export function pruneAtsDeliveries(now: Date = new Date(), retentionDays: number = DELIVERY_RETENTION_DAYS): number {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const res = db()
    .prepare(
      `DELETE FROM ats_delivery
       WHERE status IN ('delivered','failed') AND next_attempt_at IS NULL AND updated_at < ?`
    )
    .run(cutoff);
  return res.changes;
}

export function getAtsDelivery(id: number): AtsDeliveryRow | null {
  const r = db().prepare(`SELECT * FROM ats_delivery WHERE id = ?`).get(id) as RawRow | undefined;
  return r ? mapRow(r) : null;
}
