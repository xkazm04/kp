import { randomUUID } from "node:crypto";
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
// Every attempt holds its row under a LEASE; an expired one is reclaimed by the sweep.

/** After this many attempts a failed delivery stops auto-retrying and becomes a
 *  terminal dead-letter (still visible; a manual/forced replay can revive it). */
export const MAX_ATTEMPTS = 6;
/** First retry delay; doubles each attempt (1m, 2m, 4m, 8m, 16m, …). */
export const BASE_BACKOFF_MS = 60_000;

/** How long an attempt may hold its row before the sweep assumes its process died. An
 *  attempt is a DNS re-vet + a 5s-bounded fetch; five minutes is far outside that. */
export const ATS_DELIVERY_LEASE_MS = 5 * 60_000;

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
  // The claim lease. Additive, NULL by default; a lease-less pending row (pre-upgrade)
  // counts as expired once older than one lease, so already-stranded rows heal too.
  for (const col of ["lease_token TEXT", "lease_until TEXT"]) {
    try {
      d.exec(`ALTER TABLE ats_delivery ADD COLUMN ${col}`);
    } catch {
      // Already present (an earlier boot added it): the no-op we want.
    }
  }
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

function newLease(at: Date): { token: string; until: string } {
  return { token: randomUUID(), until: new Date(at.getTime() + ATS_DELIVERY_LEASE_MS).toISOString() };
}

/** Open a `pending` ledger row LEASED to the caller in the same INSERT; the token is
 *  what `finalizeAtsDelivery` must be shown. */
export function openAtsDelivery(
  event: AtsEventType,
  entryId: string,
  at: Date = new Date()
): { id: number; token: string } {
  const now = at.toISOString();
  const lease = newLease(at);
  const info = db()
    .prepare(
      `INSERT INTO ats_delivery (event, entry_id, status, attempts, created_at, updated_at, lease_token, lease_until)
       VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`
    )
    .run(event, entryId, now, now, lease.token, lease.until);
  return { id: Number(info.lastInsertRowid), token: lease.token };
}

/** `openAtsDelivery` without keeping the token (fixtures); the row is still leased. */
export function recordAtsDeliveryStart(event: AtsEventType, entryId: string, at: Date = new Date()): number {
  return openAtsDelivery(event, entryId, at).id;
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

/** CLAIM a due delivery for one sweep, as a LEASE. Two sweeps (an operator's POST
 *  /api/ats/deliveries and the cron beside it) both read the same due list, and before the
 *  claim both DELIVERED it — a duplicate hire in the customer's HRIS, which is exactly the
 *  outcome the ledger exists to prevent. The claim is a compare-and-swap on the row's
 *  (status, attempts) — `.changes === 1` means this caller owns the attempt and everyone
 *  else must skip. The flip also writes a holder token + deadline: an anonymous claim left
 *  a row pending forever when its process died. Returns the token, or null. */
export function leaseAtsDelivery(id: number, expectedAttempts: number, now: Date = new Date()): string | null {
  const lease = newLease(now);
  const res = db()
    .prepare(
      `UPDATE ats_delivery SET status='pending', next_attempt_at=NULL, lease_token=?, lease_until=?, updated_at=?
       WHERE id=? AND status='failed' AND attempts=?`
    )
    .run(lease.token, lease.until, now.toISOString(), id, expectedAttempts);
  return res.changes === 1 ? lease.token : null;
}

export function claimAtsDelivery(id: number, expectedAttempts: number, now: Date = new Date()): boolean {
  return leaseAtsDelivery(id, expectedAttempts, now) !== null;
}

const ABANDONED =
  "abandoned attempt: its process ended with no outcome recorded (lease expired); it may have landed, so the retry re-sends under the same Idempotency-Key";

type LeaseRow = { id: number; lease_token: string | null; lease_until: string | null };

const EXPIRED_PENDING = `status='pending' AND (
  (lease_until IS NOT NULL AND lease_until < @now) OR
  (lease_until IS NULL AND updated_at < @cutoff))`;

function expiryParams(now: Date): { now: string; cutoff: string } {
  return { now: now.toISOString(), cutoff: new Date(now.getTime() - ATS_DELIVERY_LEASE_MS).toISOString() };
}

/** Reclaim ONE expired row: failed, the lost attempt counted, due now (or dead at MAX).
 *  Re-asserts the token + deadline it read, so `changes === 0` = someone else got it. */
function reclaimLeaseRow(r: LeaseRow, now: Date): boolean {
  const res = db()
    .prepare(
      `UPDATE ats_delivery
       SET status='failed', attempts=attempts+1, last_status=NULL, last_error=@reason,
           next_attempt_at=CASE WHEN attempts+1 < @max THEN @now ELSE NULL END,
           lease_token=NULL, lease_until=NULL, updated_at=@now
       WHERE id=@id AND lease_token IS @token AND lease_until IS @until AND ${EXPIRED_PENDING}`
    )
    .run({
      id: r.id,
      token: r.lease_token,
      until: r.lease_until,
      reason: ABANDONED,
      max: MAX_ATTEMPTS,
      ...expiryParams(now),
    });
  return res.changes === 1;
}

/** The reaper, run first by the retry sweep. Returns how many THIS call reclaimed. */
export function reclaimExpiredAtsLeases(now: Date = new Date()): number {
  const rows = db()
    .prepare(`SELECT id, lease_token, lease_until FROM ats_delivery WHERE ${EXPIRED_PENDING}`)
    .all(expiryParams(now)) as LeaseRow[];
  let reclaimed = 0;
  for (const r of rows) if (reclaimLeaseRow(r, now)) reclaimed++;
  return reclaimed;
}

/** Pending rows past their lease: GET /api/ats/deliveries' `stranded`. */
export function countStrandedAtsDeliveries(now: Date = new Date()): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM ats_delivery WHERE ${EXPIRED_PENDING}`)
    .get(expiryParams(now)) as { n: number };
  return Number(row.n);
}

/** Force-requeue a TERMINAL dead-letter so the existing claim/finalize ladder can take
 *  one more shot under the SAME ledger id (same Idempotency-Key). The CAS is
 *  `status='failed' AND next_attempt_at IS NULL` — a delivered, live-pending, or
 *  still-due row is refused. A STRANDED pending row is reclaimed first. When attempts have already hit MAX_ATTEMPTS
 *  they drop to MAX_ATTEMPTS-1 so `listDueAtsDeliveries` (attempts < MAX) will pick
 *  the row up; a terminal refusal that never spent the ladder keeps its count.
 *  Single UPDATE, no await. */
export type RequeueAtsDeliveryResult = "ok" | "not-found" | "not-replayable";

export function requeueAtsDelivery(id: number, now: Date = new Date()): RequeueAtsDeliveryResult {
  if (!Number.isInteger(id) || id < 1) return "not-found";
  const stranded = db()
    .prepare(`SELECT id, lease_token, lease_until FROM ats_delivery WHERE id=@id AND ${EXPIRED_PENDING}`)
    .get({ id, ...expiryParams(now) }) as LeaseRow | undefined;
  const reclaimed = stranded ? reclaimLeaseRow(stranded, now) : false;
  const iso = now.toISOString();
  const res = db()
    .prepare(
      `UPDATE ats_delivery
       SET next_attempt_at=?,
           attempts=CASE WHEN attempts >= ? THEN ? ELSE attempts END,
           updated_at=?
       WHERE id=? AND status='failed' AND next_attempt_at IS NULL`
    )
    .run(iso, MAX_ATTEMPTS, MAX_ATTEMPTS - 1, iso, id);
  if (res.changes === 1 || reclaimed) return "ok";
  return getAtsDelivery(id) ? "not-replayable" : "not-found";
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
 *  overwrote the earlier one's.
 *  With a lease TOKEN (ats-egress always passes one) only the holder may finish: a zombie
 *  whose lease was reclaimed re-reads the bumped count and would pass the attempts CAS
 *  alone. Fixtures pass a Date or nothing and get the attempts CAS only. */
export function finalizeAtsDelivery(
  id: number,
  outcome: DeliveryOutcome,
  leaseOrNow?: string | Date,
  at?: Date
): boolean {
  const token = typeof leaseOrNow === "string" ? leaseOrNow : null;
  const now = leaseOrNow instanceof Date ? leaseOrNow : (at ?? new Date());
  const row = db().prepare(`SELECT attempts FROM ats_delivery WHERE id = ?`).get(id) as { attempts: number } | undefined;
  if (!row) return false;
  const attempts = row.attempts + 1;
  const iso = now.toISOString();
  const holder = token === null ? "" : ` AND status='pending' AND lease_token=?`;
  const holderArgs = token === null ? [] : [token];
  if (outcome.delivered) {
    const res = db()
      .prepare(
        `UPDATE ats_delivery SET status='delivered', attempts=?, last_status=?, last_error=NULL,
           next_attempt_at=NULL, lease_token=NULL, lease_until=NULL, updated_at=? WHERE id=? AND attempts=?${holder}`
      )
      .run(attempts, outcome.status ?? null, iso, id, row.attempts, ...holderArgs);
    return res.changes === 1;
  }
  const retryable = attempts < MAX_ATTEMPTS && !outcome.terminal;
  const nextAt = retryable ? new Date(now.getTime() + backoffMs(attempts)).toISOString() : null;
  const res = db()
    .prepare(
      `UPDATE ats_delivery SET status='failed', attempts=?, last_status=?, last_error=?,
         next_attempt_at=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE id=? AND attempts=?${holder}`
    )
    .run(
      attempts,
      outcome.status ?? null,
      (outcome.reason ?? "delivery failed").slice(0, 300),
      nextAt,
      iso,
      id,
      row.attempts,
      ...holderArgs
    );
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

/** Failed rows with no next attempt scheduled — the dead-letter count on GET
 *  /api/ats/deliveries. Distinct from `due`: these are parked until an operator
 *  force-replays them. */
export function countDeadAtsDeliveries(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM ats_delivery WHERE status='failed' AND next_attempt_at IS NULL`)
    .get() as { n: number };
  return Number(row.n);
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
 *  work, not history. `pending` rows are never swept (a stranded one is the reaper's).
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
