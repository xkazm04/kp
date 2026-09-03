// The public invite door, driven at HTTP level on a throwaway SQLite file.
//
// This route was the one untested file in the module, and it carries three
// decisions nothing pinned: the reason→status map an invitee's form branches on
// (400 weak password / 409 taken / 409 already active / 410 dead), the cookies a
// successful redeem mints, and the deliberate swallow around session signing —
// the invite is CONSUMED before the cookie is signed, so a signing failure must
// still answer ok rather than 500 an account that already exists.
//
// The bug it was written for: redeem minted the session cookie but never the
// readable `kp_entered` marker that login and register set, so in OPEN mode
// (no KP_OPERATOR_PASSWORD — the '/' gate reads that marker, home-gate-server.ts)
// a freshly redeemed member was bounced from AcceptForm's redirect to '/' back
// onto the public landing.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only
// affect later resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "invite-route-test-secret";

const { POST, GET } = await import("./route.ts");
const { createUser, getUserByEmail } = await import("../../../_lib/db/users.ts");
const { inviteMember } = await import("../../../_lib/org-service.ts");
const { getInvite } = await import("../../../_lib/db/invites.ts");
const { verifySession, SESSION_COOKIE, ENTERED_COOKIE } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";

function mint(email: string) {
  const r = inviteMember({ orgId: ORG, email, role: "recruiter" });
  assert.ok(r.ok, "precondition: the invite mints");
  return r.invite;
}

// The next/server shim's cookie reader answers name+value only, so attributes are
// read off the raw Set-Cookie lines — which is what a browser sees anyway.
const setCookie = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieValue = (res: Response, name: string): string | undefined => setCookie(res, name)?.split(";")[0].slice(name.length + 1);

// A distinct client IP per case: the door is throttled 10/min per (ip, token), and
// a shared key would let one case's retries starve the next.
let ip = 0;
const redeem = (token: string, body: unknown): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/invite/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
    }) as unknown as NextRequest,
    { params: Promise.resolve({ token }) }
  ) as unknown as Promise<Response>;

// ---- The reason → status map -------------------------------------------------

test("a too-short password is a 400 the form can correct", async () => {
  const invite = mint("route.weak@csas.cz");
  const res = await redeem(invite.token, { password: "short" });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "weak_password");
  assert.equal(getInvite(invite.token)?.status, "pending", "a refused redeem consumes nothing");
});

test("an unknown or consumed token is 410 — the dead ending, never a retry loop", async () => {
  assert.equal((await redeem("inv-does-not-exist", { password: "a-strong-pw-1" })).status, 410);
  const invite = mint("route.once@csas.cz");
  assert.equal((await redeem(invite.token, { password: "a-strong-pw-1" })).status, 200);
  assert.equal((await redeem(invite.token, { password: "a-strong-pw-1" })).status, 410, "single use");
});

test("an already-active account is 409 — redeem is provisioning, not a password reset", async () => {
  createUser({ orgId: ORG, email: "route.active@csas.cz", name: "Active", status: "active", password: "original-pw-12" });
  const invite = mint("route.active@csas.cz");
  const res = await redeem(invite.token, { password: "attacker-pw-99" });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "already_active");
});

test("an account belonging to another org is 409 email_taken", async () => {
  createUser({ orgId: "org-rival", email: "route.rival@rival.test", name: "Rival", status: "invited", password: "rival-pw-1234" });
  const invite = mint("route.rival@rival.test");
  const res = await redeem(invite.token, { password: "a-strong-pw-1" });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "email_taken");
});

// ---- The cookies a successful redeem mints -----------------------------------

test("redeem signs the invitee in on the team the invite granted", async () => {
  const invite = mint("route.session@csas.cz");
  const res = await redeem(invite.token, { name: "Route Session", password: "a-strong-pw-1" });
  assert.equal(res.status, 200);
  const session = verifySession(cookieValue(res, SESSION_COOKIE));
  assert.ok(session, "a session was signed");
  assert.equal(session.workspace, invite.workspaceId);
  assert.equal(session.sub, getUserByEmail("route.session@csas.cz")!.id);
  assert.equal(session.role, "recruiter");
  const raw = setCookie(res, SESSION_COOKIE)!;
  assert.match(raw, /HttpOnly/, "the credential is not readable by script");
  assert.match(raw, /Secure/);
  assert.match(raw, /SameSite=lax/);
  assert.match(raw, /Path=\//);
});

test("redeem sets the readable entered marker, so '/' lands on the dashboard", async () => {
  // In open mode the '/' gate (home-gate-server.ts) reads ONLY this marker; without
  // it AcceptForm's redirect to '/' returns the invitee to the public landing.
  const invite = mint("route.entered@csas.cz");
  const res = await redeem(invite.token, { name: "Route Entered", password: "a-strong-pw-1" });
  const marker = setCookie(res, ENTERED_COOKIE);
  assert.equal(cookieValue(res, ENTERED_COOKIE), "1");
  assert.ok(marker && !/HttpOnly/.test(marker), "the pre-paint theme script and the gate must be able to read it");
  assert.match(marker!, /Path=\//);
});

// ---- The swallow after the invite is consumed --------------------------------

test("a signing failure after the invite is consumed still answers ok", async () => {
  const invite = mint("route.nosecret@csas.cz");
  const secret = process.env.KP_SECRET;
  delete process.env.KP_SECRET; // signSession throws — open dev with no secret
  try {
    const res = await redeem(invite.token, { name: "No Secret", password: "a-strong-pw-1" });
    assert.equal(res.status, 200, "the account exists; a 500 here would strand a real member");
    assert.equal(setCookie(res, SESSION_COOKIE), undefined, "no session could be signed");
    assert.equal(setCookie(res, ENTERED_COOKIE), undefined, "and no marker claims one was");
  } finally {
    process.env.KP_SECRET = secret;
  }
  assert.equal(getUserByEmail("route.nosecret@csas.cz")?.status, "active", "the member was still provisioned");
  assert.equal(getInvite(invite.token)?.status, "accepted");
});

// ---- GET preview --------------------------------------------------------------

test("GET previews a redeemable invite and 404s an unknown token", async () => {
  const invite = mint("route.preview@csas.cz");
  const get = (token: string) =>
    GET(new Request(`http://localhost/api/invite/${token}`, { headers: { "x-forwarded-for": `10.0.1.${++ip}` } }) as unknown as NextRequest, {
      params: Promise.resolve({ token }),
    }) as unknown as Promise<Response>;
  const body = (await (await get(invite.token)).json()) as { valid: boolean; email: string; needsName: boolean };
  assert.equal(body.valid, true);
  assert.equal(body.email, "route.preview@csas.cz");
  assert.equal(body.needsName, true, "a brand-new invitee supplies their name");
  assert.equal((await get("inv-nope")).status, 404);
});
