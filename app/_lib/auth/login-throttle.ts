import Database from "better-sqlite3";
import { openStore } from "../db-path.ts";

// Persisted login-attempt throttle (bug-ui-scan-2026-07-09 #4). /api/auth/login
// serves BOTH per-account credential login ({email,password}) and the shared
// operator password, and had NO attempt accounting — so any invited user's email,
// and the single KP_OPERATOR_PASSWORD, was brute-forceable / credential-stuffable
// at full request rate. This records failed attempts in a fixed window keyed
// per-account AND per-IP: once a key reaches its limit inside the window every
// further attempt is refused (the route returns 429) UNTIL the window elapses, so
// a legitimate user who just mistyped is throttled briefly, never locked out
// permanently.
//
// PERSISTED, not in-memory: kp can run as several processes (a PM2 cluster / more
// than one server instance on one kp.sqlite), and a per-process Map would let an
// attacker spread guesses across workers to defeat the counter. This owns its own
// isolated connection on the shared kp.sqlite (offers-store / rediscovery-alert-
// store pattern) with an idempotent CREATE TABLE IF NOT EXISTS; WAL + busy_timeout
// serialize the cross-process increments. A single atomic UPSERT does the
// count-or-reset so two racing failures can't lose an increment.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      bucket_key TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL,
      window_start_ms INTEGER NOT NULL
    );
  `);
  _db = d;
  return d;
}

export type ThrottleOpts = { limit: number; windowMs: number };

/** True when `key` has reached its failure limit inside the CURRENT window. A
 *  window whose start is older than `windowMs` is stale (the reset), so the key is
 *  admitted again — a mistyped password never locks a user out for good. Read-only:
 *  records nothing, so the login route can fail-closed (429) BEFORE spending the
 *  scrypt/constant-time verify on a tripped bucket. `nowMs` is injectable for tests. */
export function isThrottled(key: string, opts: ThrottleOpts, nowMs: number = Date.now()): boolean {
  const row = db()
    .prepare(`SELECT fail_count, window_start_ms FROM login_attempts WHERE bucket_key = ?`)
    .get(key) as { fail_count: number; window_start_ms: number } | undefined;
  if (!row) return false;
  if (row.window_start_ms + opts.windowMs <= nowMs) return false; // window elapsed — reset
  return row.fail_count >= opts.limit;
}

/** Record one failed attempt against `key`, atomically starting a FRESH window
 *  when the previous one already elapsed (else incrementing the current one).
 *  Returns the failure count in the now-current window. One statement, so a
 *  concurrent writer on another connection can't clobber the increment. */
export function recordFailedAttempt(key: string, opts: ThrottleOpts, nowMs: number = Date.now()): number {
  const d = db();
  d.prepare(
    `INSERT INTO login_attempts (bucket_key, fail_count, window_start_ms)
     VALUES (@key, 1, @now)
     ON CONFLICT(bucket_key) DO UPDATE SET
       fail_count      = CASE WHEN window_start_ms + @windowMs <= @now THEN 1    ELSE fail_count + 1 END,
       window_start_ms = CASE WHEN window_start_ms + @windowMs <= @now THEN @now ELSE window_start_ms END`
  ).run({ key, now: nowMs, windowMs: opts.windowMs });
  const row = d.prepare(`SELECT fail_count FROM login_attempts WHERE bucket_key = ?`).get(key) as { fail_count: number };
  return row.fail_count;
}

/** Clear a key's failure record — called on a SUCCESSFUL login so a legitimate
 *  user's correct sign-in immediately frees their (and their IP's) bucket. */
export function clearFailures(key: string): void {
  db().prepare(`DELETE FROM login_attempts WHERE bucket_key = ?`).run(key);
}
