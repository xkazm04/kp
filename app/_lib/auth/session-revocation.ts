import Database from "better-sqlite3";
import { openStore } from "../db-path.ts";
import { SESSION_TTL_MS } from "./edge-verify.ts";

// Targeted session revocation — the piece session.ts used to call "deferred".
//
// kp's session is a stateless signed token with a 7-day TTL, so until this store
// existed the ONLY way to invalidate one was `KP_SESSION_EPOCH`, which invalidates
// every session on the deployment at once. "This laptop was stolen" therefore had two
// answers: sign every operator out, or wait up to a week while a cookie that can fire
// screen waves, move candidates and read every CV stays valid. An operator session is
// the highest-privilege credential in the product; a week is not an acceptable window.
//
// WHAT A REVOCATION NAMES. Not "a token" — a stateless token has no server-side
// identity to name. A row names a PRINCIPAL (whose sessions) and a SCOPE (which of
// them), both derived from SIGNED claims only, so a holder cannot re-point their
// cookie at another principal's empty revocation list:
//
//   principal         scope
//   user:<sub>        one exact `iat`  → "sign this one device out"
//   op:<workspace>    every `iat` < a cutoff → "sign out all devices"
//   ws:<workspace>
//
// One table carries both: `session_iat = ALL_SESSIONS` is the cutoff row, any other
// value is an exact match. The lookup is a single indexed read on the primary key.
//
// WHY `iat` IS A GOOD ENOUGH SESSION IDENTITY. It is not a unique one: two logins by
// the same principal inside the same millisecond share it, and revoking one would
// revoke both. That collision resolves toward OVER-revocation (one extra re-login),
// never under-revocation, which is the only direction a security control may err in —
// and it costs no minted-and-stored session id, i.e. no state on the issue path.
//
// PERSISTED on the shared kp.sqlite through its own connection (the login-throttle /
// offers-store pattern), NOT an in-process Map: kp can run as several processes on one
// database, and a per-worker list would leave a revoked cookie alive on every worker
// that did not serve the logout. Rows are pruned once they can no longer match a
// live session, so the table's size is bounded by the active session count.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS session_revocations (
      principal     TEXT    NOT NULL,
      session_iat   INTEGER NOT NULL,
      cutoff_ms     INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      reason        TEXT    NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (principal, session_iat)
    );
  `);
  _db = d;
  return d;
}

/** The `session_iat` of the per-principal CUTOFF row ("every session issued before
 *  `cutoff_ms`"), as opposed to a row naming one exact `iat`.
 *
 *  NEGATIVE on purpose. A real `iat` is a millisecond epoch, so 0 looks free — but a
 *  cookie predating the claim, or any payload whose `iat` is absent, normalizes to 0
 *  on the read path, and a sentinel of 0 would make every such session read the cutoff
 *  row as its own exact revocation. -1 is a value `Date.now()` cannot produce and
 *  `sessionIat()` never returns. */
export const ALL_SESSIONS = -1;

/** The claims a revocation can be keyed on — the signed subset of `SessionPayload`,
 *  structurally identical to what `verifySessionEdge` returns. Declared structurally
 *  (not as `SessionPayload`) so this module never imports session.ts: the proxy gate
 *  calls in here, and session.ts pulls node:crypto. */
export type RevocableSession = {
  workspace: string;
  iat?: number;
  sub?: string;
  op?: true;
};

/** The principal whose sessions a revocation governs, derived from SIGNED claims only.
 *
 *  Three arms, and the order matters. A per-user session keys on `sub`, so "sign out
 *  all devices" follows the human across every team they belong to — the workspace a
 *  session happens to sit on is not the thing being revoked. The operator-password
 *  login has no `sub` and is per-deployment-workspace, so it keys on `op:`. Anything
 *  else (a demo cookie, a pre-identity cookie) keys on its workspace, which keeps it
 *  revocable without ever letting it share a principal with the operator — the same
 *  reason `isOperatorSession` reads the explicit marker instead of inferring privilege
 *  from a missing `sub`. */
export function principalFor(session: RevocableSession): string {
  if (session.sub) return `user:${session.sub}`;
  if (session.op === true) return `op:${session.workspace}`;
  return `ws:${session.workspace}`;
}

/** A session's issue time as a lookup key: a positive finite `iat`, else 0.
 *
 *  0 is the "no usable issue time" bucket, not a real one. Such a session cannot be
 *  revoked INDIVIDUALLY (there is nothing to name it by), but it is still caught by
 *  its principal's cutoff row, because 0 is below every real cutoff — so "sign out all
 *  devices" covers it, which is the guarantee that matters. */
function sessionIat(session: RevocableSession): number {
  const iat = session.iat;
  return typeof iat === "number" && Number.isFinite(iat) && iat > 0 ? iat : 0;
}

// Reclaim rows that can no longer match a LIVE session.
//
// An exact row expires with the cookie it names (`iat + SESSION_TTL_MS`); a cutoff row
// expires once every session below the cutoff would have expired anyway
// (`cutoff_ms + SESSION_TTL_MS`). Past that point `verifySession` already rejects every
// session the row could match on expiry alone, so deleting it cannot resurrect access —
// which is the only property a prune of a security list has to have.
//
// Lazy and write-side only, like login-throttle's sweep: at most one pass per
// SWEEP_EVERY_MS of caller-supplied clock, and never on the read path — the read
// predicate is already correct in the presence of stale rows, and the gate calls it on
// every request, so it stays one statement.
const SWEEP_EVERY_MS = 60_000;
let lastSweepAt = 0;

function sweepExpired(d: Database.Database, nowMs: number): void {
  if (nowMs - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = nowMs;
  d.prepare(`DELETE FROM session_revocations WHERE expires_at_ms <= ?`).run(nowMs);
}

/** Test seam: forget the sweep's rate-limit clock so a test can assert a prune
 *  without waiting out SWEEP_EVERY_MS. */
export function _resetRevocationSweepForTests(): void {
  lastSweepAt = 0;
}

export type RevocationRow = {
  principal: string;
  sessionIat: number;
  cutoffMs: number;
  expiresAtMs: number;
  reason: string;
  createdAtMs: number;
};

// A revocation is written ONCE and never relaxed: re-revoking the same exact session is
// idempotent, and a second "sign out all devices" may only move the cutoff FORWARD
// (MAX), so a replayed or out-of-order write can never narrow a revocation already in
// force. Rows are naturally capped at one per live session per principal plus one
// cutoff row, and the sweep above collects them as the sessions they name expire.
const UPSERT = `
  INSERT INTO session_revocations
    (principal, session_iat, cutoff_ms, expires_at_ms, reason, created_at_ms)
  VALUES (@principal, @sessionIat, @cutoffMs, @expiresAtMs, @reason, @nowMs)
  ON CONFLICT(principal, session_iat) DO UPDATE SET
    cutoff_ms     = MAX(cutoff_ms, @cutoffMs),
    expires_at_ms = MAX(expires_at_ms, @expiresAtMs),
    reason        = @reason`;

/** Revoke ONE session — "sign this device out", the logout path. Keyed on the exact
 *  `iat`, so the principal's other devices stay signed in.
 *
 *  A session with no usable `iat` cannot be named individually; it returns false rather
 *  than writing a row that would read as the principal's cutoff. Use
 *  `revokeAllSessions` for that case (and it is the correct answer to a lost device
 *  anyway). */
export function revokeSession(session: RevocableSession, reason: string, nowMs: number = Date.now()): boolean {
  const iat = sessionIat(session);
  if (iat <= 0) return false;
  const d = db();
  // Sweep BEFORE the write so this revocation's own (live) row is never a candidate.
  sweepExpired(d, nowMs);
  d.prepare(UPSERT).run({
    principal: principalFor(session),
    sessionIat: iat,
    cutoffMs: iat,
    expiresAtMs: iat + SESSION_TTL_MS,
    reason,
    nowMs,
  });
  return true;
}

/** Revoke EVERY session of this principal issued before `cutoffMs` — "sign out all
 *  devices". One row, regardless of how many cookies are out there, which is what makes
 *  this affordable to offer as a button.
 *
 *  The cutoff is EXCLUSIVE (`iat < cutoff_ms`), so a re-login at or after the same
 *  millisecond survives: the operator who clicks this and immediately signs back in is
 *  not fighting their own revocation. */
export function revokeAllSessions(
  session: RevocableSession,
  reason: string,
  cutoffMs: number = Date.now(),
): { principal: string; cutoffMs: number } {
  const d = db();
  sweepExpired(d, cutoffMs);
  const principal = principalFor(session);
  d.prepare(UPSERT).run({
    principal,
    sessionIat: ALL_SESSIONS,
    cutoffMs,
    expiresAtMs: cutoffMs + SESSION_TTL_MS,
    reason,
    nowMs: cutoffMs,
  });
  return { principal, cutoffMs };
}

let _warnedLookupFailed = false;

/** Is this session revoked? One indexed read on the primary key, matching either the
 *  exact-`iat` row or the principal's cutoff row.
 *
 *  NEVER THROWS, and that posture is deliberate rather than lazy. This is called on the
 *  proxy gate's path for every gated request, so a store error has to resolve to one of
 *  two behaviours: refuse the request (fail closed) or fall back to the pre-existing
 *  signature+expiry+epoch checks (fail open on the revocation question only). Fail-open
 *  is the correct choice HERE because of who can reach each failure:
 *
 *   • a remote attacker cannot induce the error — it needs the operator's own disk to
 *     be full, gone, or corrupt — so fail-open is not an attacker-reachable bypass;
 *   • fail-closed WOULD be attacker-reachable in the other direction: anything that
 *     breaks the database turns into a deployment-wide 401 storm, and an availability
 *     kill is a cheaper attack than the one this store exists to stop.
 *
 * The degraded state is therefore never silent (one warning per process) and never
 * total: `verifySession`'s own checks and the global `KP_SESSION_EPOCH` kill-switch are
 * unaffected, which is exactly the fallback an operator reaches for when the store that
 * would have held the targeted revocation is the thing that is broken.
 *
 * `nowMs` filters EXPIRED rows, the same `expires_at_ms > now` predicate `listRevocations`
 * applies — it used to be accepted and ignored (the 2026-10-06 static sweep's finding 7,
 * a lint warning). Honouring it is not a weakening, for two reasons:
 *
 *  • it cannot drop a row while a session it would match is still live. An exact row
 *    expires at `iat + SESSION_TTL_MS`, which IS the named cookie's own `exp`; a cutoff
 *    row expires at `cutoff_ms + SESSION_TTL_MS`, and every session it matches has
 *    `iat < cutoff_ms`, so its `exp` is strictly earlier. Past either point
 *    `verifySession` already rejects the cookie on expiry alone.
 *  • `sweepExpired` already DELETES rows on exactly this predicate, so the answer
 *    changed at that boundary regardless — just non-deterministically, depending on when
 *    the lazy sweep last ran. The filter makes it deterministic and makes this read agree
 *    with `listRevocations`, which is what an operator's "active revocations" view shows. */
export function isSessionRevoked(session: RevocableSession, nowMs: number = Date.now()): boolean {
  try {
    const row = db()
      .prepare(
        `SELECT 1 AS hit FROM session_revocations
          WHERE principal = @principal
            AND expires_at_ms > @nowMs
            AND (session_iat = @iat OR (session_iat = @all AND @iat < cutoff_ms))
          LIMIT 1`,
      )
      .get({ principal: principalFor(session), iat: sessionIat(session), all: ALL_SESSIONS, nowMs }) as
      | { hit: number }
      | undefined;
    return row !== undefined;
  } catch (err) {
    if (!_warnedLookupFailed) {
      _warnedLookupFailed = true;
      console.error(
        "[auth] the session-revocation lookup failed — targeted revocation is NOT being enforced " +
          "on this process until the database is readable again. Signature, expiry and " +
          "KP_SESSION_EPOCH still apply; bump KP_SESSION_EPOCH to invalidate sessions meanwhile.",
        err,
      );
    }
    return false;
  }
}

/** Every revocation in force for one principal (or all of them) — the read behind an
 *  operator's "active revocations" view, and what the tests assert against. Expired
 *  rows are filtered rather than relied upon to be swept, so the answer does not depend
 *  on when the lazy sweep last ran. */
export function listRevocations(principal?: string, nowMs: number = Date.now()): RevocationRow[] {
  const rows = (
    principal
      ? db()
          .prepare(
            `SELECT principal, session_iat, cutoff_ms, expires_at_ms, reason, created_at_ms
               FROM session_revocations WHERE principal = ? AND expires_at_ms > ? ORDER BY created_at_ms DESC`,
          )
          .all(principal, nowMs)
      : db()
          .prepare(
            `SELECT principal, session_iat, cutoff_ms, expires_at_ms, reason, created_at_ms
               FROM session_revocations WHERE expires_at_ms > ? ORDER BY created_at_ms DESC`,
          )
          .all(nowMs)
  ) as Array<{
    principal: string;
    session_iat: number;
    cutoff_ms: number;
    expires_at_ms: number;
    reason: string;
    created_at_ms: number;
  }>;
  return rows.map((r) => ({
    principal: r.principal,
    sessionIat: r.session_iat,
    cutoffMs: r.cutoff_ms,
    expiresAtMs: r.expires_at_ms,
    reason: r.reason,
    createdAtMs: r.created_at_ms,
  }));
}
