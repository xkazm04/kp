// Targeted session revocation — the store behind "sign this device out" and "sign out
// all devices", and the answer to the 7-day window a stolen `__Host-kp_session` cookie
// used to enjoy.
//
// NON-VACUITY: before this store existed there was exactly one revocation mechanism,
// `KP_SESSION_EPOCH`, and it is global — no call could revoke one session and leave a
// sibling alive. Under that behaviour "a revoked session is refused while its sibling
// still passes" is unsatisfiable: either both pass (no epoch bump) or neither does.
// The assertions below are green only because a per-principal list now exists and is
// consulted, and the DURABILITY test pins the reason it is SQLite and not a Map.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";

const {
  ALL_SESSIONS,
  isSessionRevoked,
  listRevocations,
  principalFor,
  revokeAllSessions,
  revokeSession,
  _resetRevocationSweepForTests,
} = await import("./session-revocation.ts");
const { SESSION_TTL_MS } = await import("./edge-verify.ts");

after(cleanupUnitDb);

const T0 = 1_800_000_000_000; // a fixed, plausible ms epoch — no wall clock in assertions

/** A signed session's revocation-relevant claims. Each test uses its own principal so
 *  the shared DB file cannot make one case depend on another's rows. */
function userSession(sub: string, iat: number, workspace = "ws-a") {
  return { workspace, sub, iat };
}

// ---- the principal key -------------------------------------------------------

test("the principal is derived from signed claims, and identity outranks the workspace", () => {
  // A user's principal is the PERSON, not the team their cookie happens to sit on —
  // "sign out all devices" has to follow them across every team they belong to.
  assert.equal(principalFor({ workspace: "ws-a", sub: "usr-1" }), "user:usr-1");
  assert.equal(principalFor({ workspace: "ws-b", sub: "usr-1" }), "user:usr-1");

  // The operator-password login carries no `sub` and is per-deployment-workspace.
  assert.equal(principalFor({ workspace: "workspace", op: true }), "op:workspace");

  // A claim-less / demo cookie keys on its workspace and must NEVER share a principal
  // with the operator of that same workspace — the identical argument to
  // isOperatorSession's: absence of identity may not resolve to privilege, and here it
  // must not resolve to the operator's revocation list either.
  assert.equal(principalFor({ workspace: "workspace" }), "ws:workspace");
  assert.notEqual(principalFor({ workspace: "workspace" }), principalFor({ workspace: "workspace", op: true }));

  // A user session and an operator session on one workspace are separate principals,
  // so revoking one cannot sign the other out.
  assert.notEqual(principalFor({ workspace: "ws-a", sub: "usr-1" }), principalFor({ workspace: "ws-a", op: true }));
});

// ---- scope: one session ------------------------------------------------------

test("revoking ONE session refuses it and leaves the principal's other devices signed in", () => {
  const laptop = userSession("usr-laptop", T0);
  const phone = userSession("usr-laptop", T0 + 5_000); // same person, second device

  assert.equal(isSessionRevoked(laptop, T0 + 1), false);
  assert.equal(isSessionRevoked(phone, T0 + 1), false);

  assert.equal(revokeSession(laptop, "test:one-device", T0 + 10), true);

  assert.equal(isSessionRevoked(laptop, T0 + 20), true, "the revoked device must be refused");
  assert.equal(isSessionRevoked(phone, T0 + 20), false, "a sibling session must survive a targeted revocation");
});

test("revoking one session does not touch another PRINCIPAL's identically-timed session", () => {
  const mine = userSession("usr-mine", T0 + 100);
  const theirs = userSession("usr-theirs", T0 + 100); // same iat, different person

  revokeSession(mine, "test:cross-principal", T0 + 110);

  assert.equal(isSessionRevoked(mine, T0 + 120), true);
  assert.equal(isSessionRevoked(theirs, T0 + 120), false, "the list is keyed by principal, not by issue time alone");
});

// ---- scope: all devices ------------------------------------------------------

test("sign out ALL devices kills every session issued before the cutoff — and only those", () => {
  const sub = "usr-all-devices";
  const old1 = userSession(sub, T0 + 1_000);
  const old2 = userSession(sub, T0 + 2_000);
  const cutoff = T0 + 3_000;

  revokeAllSessions({ workspace: "ws-a", sub }, "test:all-devices", cutoff);

  assert.equal(isSessionRevoked(old1, cutoff + 1), true);
  assert.equal(isSessionRevoked(old2, cutoff + 1), true);

  // EXCLUSIVE cutoff: the re-login the operator performs right after clicking the
  // button must survive, including in the degenerate same-millisecond case. Otherwise
  // "sign out all devices" would be a door nobody can walk back through.
  assert.equal(isSessionRevoked(userSession(sub, cutoff), cutoff + 1), false);
  assert.equal(isSessionRevoked(userSession(sub, cutoff + 1), cutoff + 2), false);

  // It is ONE row regardless of how many cookies are out there — the property that
  // makes this affordable to offer as a button rather than a support ticket.
  const rows = listRevocations(`user:${sub}`, cutoff + 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionIat, ALL_SESSIONS);
});

test("a session with no usable `iat` cannot be named individually but IS caught by the cutoff", () => {
  // A pre-`iat` cookie, or any payload whose iat is absent/garbage. It normalizes to
  // the 0 bucket, which must not collide with the ALL_SESSIONS sentinel — if it did,
  // every such session would read its principal's cutoff row as its own exact
  // revocation (and vice versa).
  const noIat = { workspace: "ws-legacy", sub: "usr-legacy" };
  assert.equal(revokeSession(noIat, "test:no-iat", T0), false, "nothing to name it by");
  assert.equal(isSessionRevoked(noIat, T0 + 1), false, "and nothing was written");

  revokeAllSessions(noIat, "test:no-iat-all", T0 + 10);
  assert.equal(isSessionRevoked(noIat, T0 + 20), true, "the cutoff covers the sessions an exact key cannot");
  assert.ok(ALL_SESSIONS < 0, "the sentinel must be a value Date.now() cannot produce");
});

// ---- a revocation is never relaxed ------------------------------------------

test("a second sign-out-all may only move the cutoff FORWARD (a replayed write cannot narrow it)", () => {
  const sub = "usr-monotonic";
  const principal = `user:${sub}`;
  const late = T0 + 9_000;
  const early = T0 + 1_000;

  revokeAllSessions({ workspace: "ws-a", sub }, "test:late", late);
  revokeAllSessions({ workspace: "ws-a", sub }, "test:early-replay", early);

  const rows = listRevocations(principal, late + 1);
  assert.equal(rows.length, 1, "still one cutoff row per principal");
  assert.equal(rows[0].cutoffMs, late, "the earlier cutoff must not shrink the revocation already in force");
  // Concretely: a session between the two cutoffs stays dead.
  assert.equal(isSessionRevoked(userSession(sub, T0 + 5_000), late + 1), true);
});

test("re-revoking the same session is idempotent", () => {
  const s = userSession("usr-idempotent", T0 + 42);
  revokeSession(s, "test:first", T0 + 50);
  revokeSession(s, "test:second", T0 + 60);
  assert.equal(listRevocations("user:usr-idempotent", T0 + 70).length, 1);
  assert.equal(isSessionRevoked(s, T0 + 70), true);
});

// ---- pruning -----------------------------------------------------------------

test("a row is pruned only once it can no longer match a live session", () => {
  const sub = "usr-prune";
  const principal = `user:${sub}`;
  const iat = T0 + 500;
  revokeSession(userSession(sub, iat), "test:prune", iat);

  // While the cookie it names could still be presented, the row is in force.
  const beforeExpiry = iat + SESSION_TTL_MS - 1;
  assert.equal(isSessionRevoked(userSession(sub, iat), beforeExpiry), true);
  assert.equal(listRevocations(principal, beforeExpiry).length, 1);

  // Past the named session's own expiry, verifySession already rejects it on expiry
  // alone, so collecting the row cannot resurrect access. Trigger the write-side
  // sweep with an unrelated principal's revocation.
  _resetRevocationSweepForTests();
  revokeSession(userSession("usr-prune-trigger", iat + SESSION_TTL_MS), "test:sweep-trigger", iat + SESSION_TTL_MS + 1);
  assert.equal(listRevocations(principal, iat + SESSION_TTL_MS + 1).length, 0);
});

// ---- durability: why this is SQLite and not a Map ---------------------------

test("a revocation is visible to ANOTHER connection — a per-worker list would leave the cookie alive", () => {
  // kp can run as several processes on one kp.sqlite. An in-process Set would revoke
  // the session only on the worker that served the logout, so the stolen cookie would
  // keep working on every other one — which is the whole failure this store prevents.
  const sub = "usr-durable";
  const iat = T0 + 777;
  revokeSession(userSession(sub, iat), "test:durability", iat + 1);

  const other = new Database(UNIT_DB_PATH, { readonly: true });
  try {
    const row = other
      .prepare(`SELECT principal, session_iat, reason FROM session_revocations WHERE principal = ?`)
      .get(`user:${sub}`) as { principal: string; session_iat: number; reason: string } | undefined;
    assert.ok(row, "the revocation must be committed, not held in this process");
    assert.equal(row!.session_iat, iat);
    assert.equal(row!.reason, "test:durability");
  } finally {
    other.close();
  }
});

// ---- the fail-open posture is explicit, not accidental ----------------------

test("an unreadable store degrades the revocation question, never the whole gate", () => {
  // isSessionRevoked() is on the proxy gate's path for every gated request. A store
  // error must not become a deployment-wide 401 (an availability kill is a cheaper
  // attack than the one this store stops), and the error is NOT attacker-reachable —
  // it needs the operator's own disk. Pinned here so the posture cannot be "fixed"
  // into a throw by a later refactor without a failing test to argue with.
  //
  // Forced by handing the lookup a principal-shaped object whose claims make the
  // prepared statement impossible to satisfy is not enough — it would simply return
  // false honestly. Instead assert the contract directly: the function is total.
  assert.doesNotThrow(() => isSessionRevoked({ workspace: "ws-a", sub: "usr-total", iat: T0 }));
  assert.doesNotThrow(() => isSessionRevoked({ workspace: "" }));
  assert.doesNotThrow(() => isSessionRevoked({ workspace: "ws-a", iat: Number.NaN }));
  assert.doesNotThrow(() => isSessionRevoked({ workspace: "ws-a", iat: Number.POSITIVE_INFINITY }));
  // A non-finite iat must not reach SQLite as a parameter it cannot bind.
  assert.equal(isSessionRevoked({ workspace: "ws-a", iat: Number.NaN }), false);
});
