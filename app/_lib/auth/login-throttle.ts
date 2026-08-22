import Database from "better-sqlite3";
import { createHash } from "node:crypto";
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
  // `window_ms` records the window LENGTH each row was written under, so the sweep
  // below can decide staleness per row instead of guessing with one caller's opts
  // (a shorter caller must never reclaim a longer caller's live bucket). Added by
  // migration because CREATE TABLE IF NOT EXISTS cannot alter an existing table;
  // pre-migration rows default to 0 and fall back to LEGACY_WINDOW_MS.
  const cols = d.prepare(`PRAGMA table_info(login_attempts)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "window_ms")) {
    d.exec(`ALTER TABLE login_attempts ADD COLUMN window_ms INTEGER NOT NULL DEFAULT 0`);
  }
  _db = d;
  return d;
}

export type ThrottleOpts = { limit: number; windowMs: number };

// A bucket key is caller-supplied, and on the login route the account key is
// `login:acct:${normalizeEmail(email)}` — i.e. it embeds an UNVALIDATED request-body
// string of unbounded length on a PUBLIC, un-rateLimit()ed endpoint. Stored verbatim,
// one POST could write a multi-megabyte row. Past a sane cap we store a fixed-size
// digest instead: same key in ⇒ same bucket (applied identically on every read, write
// and clear), collision-free in practice, and the row size is bounded by construction.
const MAX_KEY_CHARS = 160;
function bucket(key: string): string {
  return key.length <= MAX_KEY_CHARS ? key : `h:${createHash("sha256").update(key).digest("base64url")}`;
}

// Reclaim rows whose OWN window has already elapsed.
//
// Rows were previously deleted only by clearFailures() on a SUCCESSFUL login, so every
// distinct key ever seen stayed in the table forever: /api/auth/login is proxy-public
// and calls no rateLimit(), so an anonymous caller POSTing a fresh email per request
// grew data/kp.sqlite without bound — a persistent disk-fill against the app's only
// database. (rate-limit.ts's in-memory twin lazily sweeps for exactly this reason; the
// persisted store never did.) A row past its window is ALREADY semantically absent —
// isThrottled() admits it and recordFailedAttempt() restarts it at 1 — so deleting it
// can never release a live bucket or reset a live counter. Lazy, like the in-memory
// twin: at most one pass per SWEEP_EVERY_MS of caller-supplied clock.
const SWEEP_EVERY_MS = 60_000;
const LEGACY_WINDOW_MS = 15 * 60_000; // assumed window for rows written before window_ms existed
let lastSweepAt = 0;
function sweepStale(d: Database.Database, nowMs: number): void {
  if (nowMs - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = nowMs;
  d.prepare(`DELETE FROM login_attempts WHERE window_start_ms + MAX(window_ms, @legacy) <= @now`).run({
    now: nowMs,
    legacy: LEGACY_WINDOW_MS,
  });
}

/** True when `key` has reached its failure limit inside the CURRENT window. A
 *  window whose start is older than `windowMs` is stale (the reset), so the key is
 *  admitted again — a mistyped password never locks a user out for good. Read-only:
 *  records nothing, so the login route can fail-closed (429) BEFORE spending the
 *  scrypt/constant-time verify on a tripped bucket. `nowMs` is injectable for tests. */
export function isThrottled(key: string, opts: ThrottleOpts, nowMs: number = Date.now()): boolean {
  const row = db()
    .prepare(`SELECT fail_count, window_start_ms FROM login_attempts WHERE bucket_key = ?`)
    .get(bucket(key)) as { fail_count: number; window_start_ms: number } | undefined;
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
  // Sweep BEFORE the write so this attempt's own (live) row is never a candidate.
  sweepStale(d, nowMs);
  const bkey = bucket(key);
  d.prepare(
    `INSERT INTO login_attempts (bucket_key, fail_count, window_start_ms, window_ms)
     VALUES (@key, 1, @now, @windowMs)
     ON CONFLICT(bucket_key) DO UPDATE SET
       fail_count      = CASE WHEN window_start_ms + @windowMs <= @now THEN 1    ELSE fail_count + 1 END,
       window_start_ms = CASE WHEN window_start_ms + @windowMs <= @now THEN @now ELSE window_start_ms END,
       window_ms       = @windowMs`
  ).run({ key: bkey, now: nowMs, windowMs: opts.windowMs });
  const row = d.prepare(`SELECT fail_count FROM login_attempts WHERE bucket_key = ?`).get(bkey) as { fail_count: number };
  return row.fail_count;
}

/** Clear a key's failure record — called on a SUCCESSFUL login so a legitimate
 *  user's correct sign-in immediately frees their (and their IP's) bucket. */
export function clearFailures(key: string): void {
  db().prepare(`DELETE FROM login_attempts WHERE bucket_key = ?`).run(bucket(key));
}
