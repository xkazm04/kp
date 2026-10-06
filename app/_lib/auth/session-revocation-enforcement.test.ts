// A revocation that is written but never CONSULTED is a log file, not a control.
//
// session-revocation.test.ts proves the store. This file proves the enforcement: that a
// revoked cookie is actually refused at each seam a request can arrive through, and that
// the door which writes the revocation — POST /api/auth/logout — really closes the one
// the operator is holding AND every other copy of it.
//
// The flow under test is the stolen-laptop one:
//   the attacker holds a valid `__Host-kp_session` copy → the operator signs out all
//   devices from another machine → the stolen copy stops working, and it stops working
//   without KP_SESSION_EPOCH, i.e. without signing every other operator out too.
//
// NON-VACUITY: every assertion here is preceded by its own "still works" probe on the
// same cookie, so a test that passed because the session was invalid for some unrelated
// reason (wrong secret, expired, demo workspace) would fail the probe first.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../testing/unit-db.ts";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` needs a Next request scope; these tests are ABOUT what the auth helpers
// decide from the cookie jar, so resolve it to a virtual module this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpRevokeTestCookie?: () => string | null }).__kpRevokeTestCookie = () => cookieValue;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpRevokeTestCookie();
            return {
              get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined),
              set: () => {},
            };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// A secret AND an operator password: without the password every caller folds to owner
// (open dev mode) and there is no authorization decision left to revoke.
process.env.KP_SECRET = "session-revocation-enforcement-secret";
process.env.KP_OPERATOR_PASSWORD = "session-revocation-enforcement-password";

const { isOperator, requireOperator } = await import("./require-operator.ts");
const { currentSession, requireCapability } = await import("./current-user.ts");
const { signSession, verifySession, SESSION_TTL_MS } = await import("./session.ts");
const { isSessionRevoked, listRevocations, revokeAllSessions, revokeSession } = await import("./session-revocation.ts");
const { POST: logout } = await import("../../api/auth/logout/route.ts");
const { createWorkspace } = await import("../db/workspaces.ts");
const { createUser } = await import("../db/users.ts");
const { upsertMembership } = await import("../db/memberships.ts");

after(cleanupUnitDb);

const ORG = "org-default";

function withCookie(token: string | null): void {
  cookieValue = token;
}

function logoutRequest(body?: Record<string, unknown>): Request {
  return new Request("https://kp.test/api/auth/logout", {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---- the operator gate -------------------------------------------------------

test("a revoked OPERATOR cookie is no longer an operator — and its sibling still is", async () => {
  const now = Date.now();
  const stolen = signSession(undefined, now, { op: true });
  const stillMine = signSession(undefined, now + 1_000, { op: true });

  // Probe: both are genuinely operator sessions before anything is revoked. This is
  // what makes the refusal below meaningful rather than a signature failure.
  withCookie(stolen);
  assert.equal(await isOperator(), true);
  withCookie(stillMine);
  assert.equal(await isOperator(), true);

  revokeSession({ workspace: "workspace", op: true, iat: now }, "test:stolen-laptop", now);

  withCookie(stolen);
  assert.equal(await isOperator(), false, "the revoked operator cookie must lose operator authority");
  const denied = await requireOperator();
  assert.ok(denied, "requireOperator must refuse it");
  assert.equal(denied!.status, 401);

  withCookie(stillMine);
  assert.equal(await isOperator(), true, "a targeted revocation must not sign the other device out");
});

// ---- the boundary the two halves meet on ------------------------------------
//
// The 2026-10-06 boundary scan. A revocation row is gone at `expires_at_ms <= now`
// (swept at session-revocation.ts:124, filtered out of `isSessionRevoked` and
// `listRevocations`), and an exact row's `expires_at_ms` IS `iat + SESSION_TTL_MS`,
// i.e. the named cookie's own `exp`. `verifySession` rejected on `exp < now`, so at
// exactly `now === exp` the cookie verified AND no row was left to refuse it: a 1 ms
// window in which a revoked session was enforced by nothing at all.
//
// The fix picked ONE convention for the whole lifecycle — the half-open window
// `[iat, exp)` — which leaves the store's predicates untouched and makes the two sides
// meet exactly instead of one millisecond apart. This test is the seam itself.
test("a revoked cookie is dead at exactly exp — the window and the row meet, with no gap", () => {
  const iat = Date.now();
  const exp = iat + SESSION_TTL_MS;
  const workspace = "ws-expiry-boundary";
  const token = signSession(workspace, iat, { op: true });
  const principal = { workspace, op: true as const, iat };

  revokeSession(principal, "test:expiry-boundary", iat);

  // Probe: one millisecond earlier BOTH halves are live — the cookie verifies on its
  // own merits and the row is what refuses it. Without this the assertions below could
  // pass on a token that was never valid.
  assert.ok(verifySession(token, exp - 1), "at exp - 1 the cookie still verifies");
  assert.equal(isSessionRevoked(principal, exp - 1), true, "…and at exp - 1 the row refuses it");

  // At exactly `exp` the row is gone — correctly, it can no longer name a live session.
  assert.equal(isSessionRevoked(principal, exp), false, "the row expires with the cookie it names");
  // …so the window itself has to be the refusal. This is the assertion that was red.
  assert.equal(verifySession(token, exp), null, "no row left, so a revoked cookie must not verify at exp");

  // And past it, unchanged.
  assert.equal(verifySession(token, exp + 1), null, "still dead at exp + 1");
  assert.equal(isSessionRevoked(principal, exp + 1), false);
});

// ---- the per-user capability layer ------------------------------------------

test("a revoked USER cookie resolves to no session, so every capability gate answers 401", async () => {
  const user = createUser({ orgId: ORG, email: "revoked@kp.test", name: "Revoked Owner", status: "active" });
  const workspace = createWorkspace("Revoke Team", user.orgId);
  upsertMembership(user.id, workspace.id, "owner");

  const now = Date.now();
  const token = signSession(workspace.id, now, { sub: user.id, org: user.orgId, role: "owner" });
  withCookie(token);

  // Probe: an owner holds pipeline:write, so the gate is open before revocation.
  assert.ok(await currentSession(), "the session must verify before it is revoked");
  assert.equal(await requireCapability("pipeline:write"), null);

  revokeAllSessions({ workspace: workspace.id, sub: user.id }, "test:sign-out-all", now + 1);

  assert.equal(await currentSession(), null, "a revoked session must read as no session at all");
  const denied = await requireCapability("pipeline:write");
  assert.ok(denied);
  assert.equal(
    denied!.status,
    401,
    "401 (not authenticated), never 403 — a revoked cookie is not an under-privileged caller",
  );
});

test("sign-out-all follows the PERSON across teams, not the workspace the cookie sits on", async () => {
  const user = createUser({ orgId: ORG, email: "multi-team@kp.test", name: "Multi Team", status: "active" });
  const teamA = createWorkspace("Team A", user.orgId);
  const teamB = createWorkspace("Team B", user.orgId);
  upsertMembership(user.id, teamA.id, "owner");
  upsertMembership(user.id, teamB.id, "owner");

  const now = Date.now();
  const onTeamA = signSession(teamA.id, now, { sub: user.id, org: user.orgId, role: "owner" });
  const onTeamB = signSession(teamB.id, now, { sub: user.id, org: user.orgId, role: "owner" });

  withCookie(onTeamA);
  assert.ok(await currentSession());
  withCookie(onTeamB);
  assert.ok(await currentSession());

  revokeAllSessions({ workspace: teamA.id, sub: user.id }, "test:cross-team", now + 1);

  // One row, keyed `user:<sub>`, and BOTH cookies are dead. A workspace-keyed list
  // would have left the second team's cookie alive — which is why the revocation
  // principal is the person and the table is exempt from the workspace-scoping rule.
  withCookie(onTeamA);
  assert.equal(await currentSession(), null);
  withCookie(onTeamB);
  assert.equal(await currentSession(), null, "the other team's cookie must die with it");
});

// ---- the door that writes it ------------------------------------------------

test("POST /api/auth/logout revokes THIS session — clearing the cookie is not signing out", async () => {
  const now = Date.now();
  const token = signSession(undefined, now, { op: true });
  withCookie(token);
  assert.equal(await isOperator(), true);

  const res = await logout(logoutRequest());
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { ok: boolean; revoked: boolean; scope: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.revoked, true, "the delivery claim is truthful — it really wrote the revocation");
  assert.equal(payload.scope, "session");

  // The cookie is still expired in the browser, as before…
  assert.equal(res.cookies.get(SESSION_COOKIE)?.value, "");
  // …and the COPY the operator no longer holds is dead too, which is the new part.
  assert.equal(isSessionRevoked({ workspace: "workspace", op: true, iat: now }), true);
  withCookie(token);
  assert.equal(await isOperator(), false, "the presented-again cookie must be refused");
});

test("POST /api/auth/logout {allDevices:true} revokes every session of the principal", async () => {
  // Both sessions were minted BEFORE the button is pressed, which is the real flow —
  // the cutoff is the moment of the click, and everything already issued falls below it.
  const now = Date.now();
  const sub = "usr-logout-all";
  const workspace = "ws-logout-all";
  const laptop = signSession(workspace, now - 60_000, { sub, org: "org-x", role: "owner" });
  const phone = signSession(workspace, now - 2_000, { sub, org: "org-x", role: "owner" });

  // Probe: the lost laptop's cookie is live right now. This is the attacker's copy.
  withCookie(laptop);
  assert.ok(await currentSession(), "the stolen cookie must be valid before the button is pressed");

  // Sign out all devices FROM the phone — the realistic flow: the laptop is gone.
  withCookie(phone);
  const res = await logout(logoutRequest({ allDevices: true }));
  const payload = (await res.json()) as { revoked: boolean; scope: string };
  assert.equal(payload.revoked, true);
  assert.equal(payload.scope, "all-devices");

  const rows = listRevocations(`user:${sub}`);
  assert.equal(rows.length, 1, "one row, however many cookies are out there");

  // Both the lost laptop AND the phone that pressed the button are signed out.
  assert.equal(isSessionRevoked({ workspace, sub, iat: now - 60_000 }), true);
  assert.equal(isSessionRevoked({ workspace, sub, iat: now - 2_000 }), true);
  // …and presenting the stolen cookie again now reads as no session at all.
  withCookie(laptop);
  assert.equal(await currentSession(), null, "the stolen cookie is dead without an epoch bump");
  // A fresh sign-in after the cutoff is NOT caught — the door has to be walkable back.
  assert.equal(isSessionRevoked({ workspace, sub, iat: Date.now() + 60_000 }), false);
});

test("an anonymous logout writes nothing — the cookie presented IS the authority to revoke", async () => {
  withCookie(null);
  const before = listRevocations().length;
  const res = await logout(logoutRequest({ allDevices: true }));
  const payload = (await res.json()) as { ok: boolean; revoked: boolean };
  assert.equal(payload.ok, true, "it still clears the browser and still answers ok");
  assert.equal(payload.revoked, false, "…but it reports honestly that it revoked nothing");
  assert.equal(listRevocations().length, before, "an unauthenticated caller cannot revoke, nor grow the table");
});

test("the logout body is read under a byte cap — it is a proxy-public door", async () => {
  withCookie(null);
  const res = await logout(
    new Request("https://kp.test/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allDevices: true, pad: "x".repeat(4096) }),
    }),
  );
  assert.equal(res.status, 413);
});
