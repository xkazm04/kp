import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

test("user and operator credential failures share a coded 401", async () => {
  const previous = process.env.KP_OPERATOR_PASSWORD;
  process.env.KP_OPERATOR_PASSWORD = "test-operator-secret";
  try {
    const request = (body: object) => new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const user = await POST(request({ email: "missing@example.invalid", password: "bad" }));
    const operator = await POST(request({ password: "bad" }));
    assert.equal(user.status, 401);
    assert.equal(operator.status, 401);
    const userBody = await user.json();
    assert.deepEqual(userBody, await operator.json());
    assert.equal(userBody.code, "LOGIN_CREDENTIALS_INVALID");
  } finally {
    if (previous === undefined) delete process.env.KP_OPERATOR_PASSWORD;
    else process.env.KP_OPERATOR_PASSWORD = previous;
  }
});

// ---- challenge-r04 auth-session-rbac/A: the login door mints through the issuer -------

const loginRequest = (body: object) =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const cookieLine = (res: Response, name: string): string | undefined => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const attrSet = (line: string | undefined): string[] =>
  (line ?? "").split(";").slice(1).map((a) => a.trim().toLowerCase()).filter((a) => !a.startsWith("expires=")).sort(); // real Next derives Expires from Max-Age

test("a user with no team, in an org that is not the install's, lands on their OWN org's first team", async () => {
  process.env.KP_SECRET = "login-route-test-secret";
  const { createUser } = await import("../../../_lib/db/users.ts");
  const { createOrganization } = await import("../../../_lib/db/organizations.ts");
  const { createWorkspace, DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
  const { upsertMembership, removeMembership } = await import("../../../_lib/db/memberships.ts");
  const { verifySession, SESSION_COOKIE } = await import("../../../_lib/auth/session.ts");

  const org = createOrganization("Login Landing Org");
  const team = createWorkspace("Login landing team", org.id);
  const user = createUser({ orgId: org.id, email: "login.landing@csas.cz", status: "active", password: "login-pw-1234" });
  upsertMembership(user.id, team.id, "recruiter");
  removeMembership(user.id, team.id); // every membership removed; the account stays active

  const res = await POST(loginRequest({ email: "login.landing@csas.cz", password: "login-pw-1234" }));
  assert.equal(res.status, 200);
  const payload = verifySession(cookieLine(res, SESSION_COOKIE)?.split(";")[0].slice(SESSION_COOKIE.length + 1));
  assert.ok(payload, "a session was minted");
  assert.notEqual(payload.workspace, DEFAULT_WORKSPACE_ID, "never the install's home workspace");
  assert.equal(payload.workspace, team.id, "the first team of the user's own org");
  assert.equal(payload.org, org.id);
  assert.equal(payload.role, undefined, "no membership, no role: read-gated as before");
});

test("login answers the session and kp_entered with the one attribute set", async () => {
  process.env.KP_SECRET = "login-route-test-secret";
  const { createUser } = await import("../../../_lib/db/users.ts");
  const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
  const { SESSION_COOKIE, ENTERED_COOKIE } = await import("../../../_lib/auth/session.ts");
  const user = createUser({ orgId: "org-default", email: "login.attrs@csas.cz", status: "active", password: "login-pw-1234" });
  upsertMembership(user.id, "workspace", "recruiter");

  const res = await POST(loginRequest({ email: "login.attrs@csas.cz", password: "login-pw-1234" }));
  assert.equal(res.status, 200);
  assert.deepEqual(attrSet(cookieLine(res, SESSION_COOKIE)), ["httponly", "max-age=604800", "path=/", "samesite=lax", "secure"]);
  assert.deepEqual(attrSet(cookieLine(res, ENTERED_COOKIE)), ["max-age=604800", "path=/", "samesite=lax", "secure"]);
  assert.match(cookieLine(res, ENTERED_COOKIE) ?? "", /^kp_entered=1;/);
});
