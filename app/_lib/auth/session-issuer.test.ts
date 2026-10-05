// The one session issuer (challenge-r04 auth-session-rbac/A).
//
// Five route files used to hand-mint sessions: each called signSession() with
// claims it had assembled itself and set the cookie pair with attributes it had
// typed itself. The route comments record four defects that came from exactly that
// (a re-mint that dropped claims and made a member an owner, an invite that signed
// the oldest team, an invite that forgot kp_entered, a demo cookie re-minted onto
// the real tenant), and a fifth was live: switch-workspace renewed a DISABLED
// user's cookie because it never read users.status.
//
// These cases pin the issuer's contract: the principal is typed, org and role come
// from the database, the account and the workspace are re-checked on every mint,
// the cookie attributes are byte-identical to what the doors set by hand, and a
// source ratchet keeps a sixth door from minting on its own.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";

process.env.KP_SECRET = "session-issuer-test-secret";

const { NextResponse } = await import("next/server");
const issuer = await import("./session-issuer.ts");
const { issueSession, clearSession, landingWorkspaceFor } = issuer;
type SessionPrincipal = import("./session-issuer.ts").SessionPrincipal;
const { verifySession, SESSION_COOKIE, ENTERED_COOKIE, SESSION_TTL_MS } = await import("./session.ts");
const { createUser, setUserStatus } = await import("../db/users.ts");
const { createOrganization } = await import("../db/organizations.ts");
const { createWorkspace, DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");
const { upsertMembership, removeMembership } = await import("../db/memberships.ts");

after(() => cleanupUnitDb());

const HOME_ORG = "org-default";
const MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
let seq = 0;
const email = (tag: string) => `issuer.${tag}.${++seq}@csas.cz`;

const setCookie = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieValue = (res: Response, name: string): string | undefined => setCookie(res, name)?.split(";")[0].slice(name.length + 1);
/** The attribute set of one Set-Cookie line, order-free and case-normalised on the name. */
const attrs = (line: string | undefined): string[] =>
  (line ?? "")
    .split(";")
    .slice(1)
    .map((a) => a.trim())
    .map((a) => (a.includes("=") ? `${a.split("=")[0].toLowerCase()}=${a.split("=").slice(1).join("=").toLowerCase()}` : a.toLowerCase()))
    // Next derives Expires from Max-Age at serialisation time; Max-Age is the pinned one.
    .filter((a) => !a.startsWith("expires="))
    .sort();
/** Set-Cookie lines with the clock-derived Expires masked, so two serialisations a
 *  second apart still compare byte-for-byte on everything a door chooses. */
const lines = (res: Response): string[] => res.headers.getSetCookie().map((c) => c.replace(/Expires=[^;]*/i, "Expires=<t>"));
const decode = (token: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from((token ?? "").split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;

// ---- 1. A disabled account is refused, and no cookie is set ------------------------

test("issueSession refuses a disabled user with reason 'inactive' and sets no session cookie", () => {
  const u = createUser({ orgId: HOME_ORG, email: email("disabled"), status: "active", password: "issuer-pw-123" });
  upsertMembership(u.id, DEFAULT_WORKSPACE_ID, "recruiter");
  setUserStatus(u.id, "disabled");
  const res = NextResponse.json({ ok: true });
  const r = issueSession(res, { kind: "user", userId: u.id, workspaceId: DEFAULT_WORKSPACE_ID });
  assert.deepEqual(r, { ok: false, reason: "inactive" });
  assert.equal(setCookie(res, SESSION_COOKIE), undefined, "a refused principal gets no session");
  assert.equal(setCookie(res, ENTERED_COOKIE), undefined, "…and no marker claiming one");
});

test("issueSession refuses a user id that names no account", () => {
  const res = NextResponse.json({ ok: true });
  const r = issueSession(res, { kind: "user", userId: "u_does_not_exist", workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(r.ok, false);
  assert.equal(setCookie(res, SESSION_COOKIE), undefined);
});

// ---- 3. A workspace of another org is refused ---------------------------------------

test("issueSession refuses a workspace that belongs to another org with 'foreign_workspace'", () => {
  const other = createOrganization("Issuer Other Org");
  const foreignWs = createWorkspace("Foreign team", other.id);
  const u = createUser({ orgId: HOME_ORG, email: email("foreign"), status: "active", password: "issuer-pw-123" });
  // Even a membership row does not make another org's team this user's to enter.
  upsertMembership(u.id, foreignWs.id, "recruiter");
  const res = NextResponse.json({ ok: true });
  const r = issueSession(res, { kind: "user", userId: u.id, workspaceId: foreignWs.id });
  assert.deepEqual(r, { ok: false, reason: "foreign_workspace" });
  assert.equal(setCookie(res, SESSION_COOKIE), undefined);

  const phantom = NextResponse.json({ ok: true });
  assert.deepEqual(issueSession(phantom, { kind: "user", userId: u.id, workspaceId: "ws_phantom" }), { ok: false, reason: "foreign_workspace" });
});

// ---- 4. Claims come from the database, never from the caller ------------------------

test("a user token carries org = users.org_id and role = memberships.role, read from the DB", () => {
  const org = createOrganization("Issuer Claims Org");
  const ws = createWorkspace("Claims team", org.id);
  const u = createUser({ orgId: org.id, email: email("claims"), status: "active", password: "issuer-pw-123" });
  upsertMembership(u.id, ws.id, "hiring_manager");
  const res = NextResponse.json({ ok: true });
  const r = issueSession(res, { kind: "user", userId: u.id, workspaceId: ws.id });
  assert.equal(r.ok, true);
  const token = cookieValue(res, SESSION_COOKIE);
  const payload = verifySession(token);
  assert.ok(payload, "the minted token verifies");
  assert.equal(payload.sub, u.id);
  assert.equal(payload.org, org.id);
  assert.equal(payload.role, "hiring_manager");
  assert.equal(payload.workspace, ws.id);
  assert.equal(payload.op, undefined, "a user token is never an operator token");
  assert.equal(r.ok && r.token, token, "the result hands back the token it set");
});

test("the operator token has op:true and no identity; the open token has neither", () => {
  const res = NextResponse.json({ ok: true });
  assert.equal(issueSession(res, { kind: "operator" }).ok, true);
  const op = decode(cookieValue(res, SESSION_COOKIE));
  assert.equal(op.op, true);
  assert.equal(op.sub, undefined);
  assert.equal(op.org, undefined);
  assert.equal(op.role, undefined);
  assert.equal(op.workspace, DEFAULT_WORKSPACE_ID);

  const openRes = NextResponse.json({ ok: true });
  assert.equal(issueSession(openRes, { kind: "open" }).ok, true);
  const open = decode(cookieValue(openRes, SESSION_COOKIE));
  assert.deepEqual(Object.keys(open).sort(), ["epoch", "exp", "iat", "workspace"], "an open token carries no claims at all");
});

// Compile-time half of case 4: the principal admits no caller-supplied org/role and no
// operator+user combination. `tsc` fails this file if a member ever grows those keys.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type KeysOf<K extends SessionPrincipal["kind"]> = keyof Extract<SessionPrincipal, { kind: K }>;
const principalShape: [
  Equals<KeysOf<"user">, "kind" | "userId" | "workspaceId">,
  Equals<KeysOf<"operator">, "kind" | "workspaceId">,
  Equals<KeysOf<"open">, "kind" | "workspaceId">,
  Equals<SessionPrincipal["kind"], "user" | "operator" | "open">,
] = [true, true, true, true];

test("the principal type has no org, role, op or sub field on any member", () => {
  assert.deepEqual(principalShape, [true, true, true, true]);
});

// ---- 5. One attribute set, byte-identical to the hand-set cookies --------------------

test("issueSession sets __Host-kp_session and kp_entered with exactly the attributes the doors set by hand", () => {
  const res = NextResponse.json({ ok: true });
  issueSession(res, { kind: "operator" });
  const token = cookieValue(res, SESSION_COOKIE)!;

  // The literal options every door passed before the issuer existed (login/route.ts
  // withSessionCookie + setEntered, register/route.ts, invite/[token]/route.ts).
  const legacy = NextResponse.json({ ok: true });
  legacy.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  legacy.cookies.set(ENTERED_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  assert.deepEqual(lines(res), lines(legacy), "byte-identical Set-Cookie lines, in the same order");

  assert.deepEqual(attrs(setCookie(res, SESSION_COOKIE)), ["httponly", `max-age=${MAX_AGE}`, "path=/", "samesite=lax", "secure"]);
  assert.equal(MAX_AGE, 604800);
  assert.deepEqual(attrs(setCookie(res, ENTERED_COOKIE)), [`max-age=${MAX_AGE}`, "path=/", "samesite=lax", "secure"]);
  assert.equal(cookieValue(res, ENTERED_COOKIE), "1");
});

test("a renewal (entered:false) sets only the session cookie, exactly as switch-workspace did", () => {
  const res = NextResponse.json({ ok: true });
  issueSession(res, { kind: "operator", workspaceId: DEFAULT_WORKSPACE_ID }, { entered: false });
  const token = cookieValue(res, SESSION_COOKIE)!;
  const legacy = NextResponse.json({ ok: true });
  legacy.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
  assert.deepEqual(lines(res), lines(legacy));
});

test("clearSession expires both cookies with the attributes logout set by hand", () => {
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  const legacy = NextResponse.json({ ok: true });
  legacy.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  legacy.cookies.set(ENTERED_COOKIE, "", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  assert.deepEqual(lines(res), lines(legacy));
  assert.ok(attrs(setCookie(res, SESSION_COOKIE)).includes("max-age=0"));
});

// ---- 6. A user with no team lands in their OWN org ----------------------------------

test("landingWorkspaceFor: own-org membership first, else the own org's first team, never the install home", () => {
  const org = createOrganization("Issuer Landing Org");
  const first = createWorkspace("Landing first", org.id);
  const second = createWorkspace("Landing second", org.id);
  const u = createUser({ orgId: org.id, email: email("landing"), status: "active", password: "issuer-pw-123" });
  upsertMembership(u.id, second.id, "recruiter");
  assert.equal(landingWorkspaceFor(u.id), second.id, "the team the user belongs to");
  removeMembership(u.id, second.id);
  assert.equal(landingWorkspaceFor(u.id), first.id, "no team left: the org's first team");
  assert.notEqual(landingWorkspaceFor(u.id), DEFAULT_WORKSPACE_ID);

  const home = createUser({ orgId: HOME_ORG, email: email("landing-home"), status: "active", password: "issuer-pw-123" });
  assert.equal(landingWorkspaceFor(home.id), DEFAULT_WORKSPACE_ID, "a home-org user with no team keeps today's landing");

  const empty = createOrganization("Issuer Empty Org");
  const stray = createUser({ orgId: empty.id, email: email("landing-empty"), status: "active", password: "issuer-pw-123" });
  assert.equal(landingWorkspaceFor(stray.id), null, "an org with no team has nowhere to land — never another org's");
});

// ---- 7. Source ratchet: no sixth door mints by hand ---------------------------------

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ISSUER = path.join("app", "_lib", "auth", "session-issuer.ts");
const SIGNER = path.join("app", "_lib", "auth", "session.ts"); // defines signSession; mints nothing

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.(ts|tsx|mts)$/.test(name)) {
      yield full;
    }
  }
}

/** Comments are prose, not mints: a route that EXPLAINS the old defect must not trip. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("no file under app/ except session-issuer.ts calls signSession( or cookies.set(SESSION_COOKIE", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, "app"))) {
    const rel = path.relative(ROOT, file);
    if (rel === ISSUER || rel === SIGNER) continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (/\bsignSession\s*\(/.test(code) || /cookies\s*\.\s*set\s*\(\s*SESSION_COOKIE\b/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "a door minted or set the session by hand — route it through session-issuer.ts");
});

test("the ratchet itself sees a hand mint (shape fixture)", () => {
  const sample = `const t = signSession(ws, Date.now(), { op: true });\nres.cookies.set(SESSION_COOKIE, t, {});`;
  assert.ok(/\bsignSession\s*\(/.test(stripComments(sample)));
  assert.ok(/cookies\s*\.\s*set\s*\(\s*SESSION_COOKIE\b/.test(stripComments(sample)));
  assert.ok(!/\bsignSession\s*\(/.test(stripComments(`// signSession(workspaceId) used to drop the claims`)));
});

// ---- 8. A RENEWAL names its prior session, and a revoked one is refused -------------
//
// S-02 of the 2026-10-05 auth scan: /api/auth/switch-workspace is public (the /api/auth/
// prefix), so proxy.ts — the one place revocation was consulted for an already-minted
// cookie — never runs on it, and the route hands back a fresh 7-day token on a NEW `iat`.
// A revocation names (principal, iat): an exact row names the OLD iat, and a "sign out
// all devices" cutoff matches `iat < cutoff` while the re-mint's iat is now. So neither
// shape caught the new token and one POST turned a revoked cookie back into a live
// session. The issuer's own account re-read cannot cover it — "sign out all devices"
// leaves the account deliberately ACTIVE.
//
// The scan fixed it with an inline check in the route. These cases move the check to the
// issuer, because the route was only the first renewal door: a second one could leave the
// check out and nothing would notice. The issuer already is the single mint; a renewal
// now NAMES its prior session, and the issuer refuses a revoked one before it signs.

const { revokeSession, revokeAllSessions } = await import("./session-revocation.ts");
type RevocableSession = import("./session-revocation.ts").RevocableSession;

/** A member of the home org with a membership on the default workspace, plus the
 *  verified prior session a renewal of theirs would carry. */
function renewable(tag: string, iat: number): { userId: string; prior: RevocableSession } {
  const u = createUser({ orgId: HOME_ORG, email: email(tag), status: "active", password: "issuer-pw-123" });
  upsertMembership(u.id, DEFAULT_WORKSPACE_ID, "recruiter");
  return { userId: u.id, prior: { workspace: DEFAULT_WORKSPACE_ID, iat, sub: u.id } };
}

test("issueSession refuses a renewal of a REVOKED prior session (exact-iat row) and sets no cookie", () => {
  const iat = Date.now();
  const { userId, prior } = renewable("revoked-exact", iat);
  const principal: SessionPrincipal = { kind: "user", userId, workspaceId: DEFAULT_WORKSPACE_ID };

  // Non-vacuity: the identical renewal succeeds while the prior session is live, so the
  // refusal below cannot be a status, membership or workspace failure wearing a new name.
  const live = NextResponse.json({ ok: true });
  assert.equal(issueSession(live, principal, { entered: false, renewing: prior }).ok, true, "precondition: a live prior session renews");

  assert.equal(revokeSession(prior, "test:stolen-laptop"), true);
  const res = NextResponse.json({ ok: true });
  assert.deepEqual(issueSession(res, principal, { entered: false, renewing: prior }), { ok: false, reason: "revoked" });
  assert.equal(setCookie(res, SESSION_COOKIE), undefined, "a revoked renewal gets no fresh token");
  assert.equal(setCookie(res, ENTERED_COOKIE), undefined, "…and no marker claiming one");
});

test("issueSession refuses a renewal caught by a 'sign out all devices' CUTOFF row", () => {
  const iat = Date.now();
  const { userId, prior } = renewable("revoked-cutoff", iat);
  const principal: SessionPrincipal = { kind: "user", userId, workspaceId: DEFAULT_WORKSPACE_ID };

  const live = NextResponse.json({ ok: true });
  assert.equal(issueSession(live, principal, { entered: false, renewing: prior }).ok, true, "precondition: a live prior session renews");

  // The cutoff is exclusive, so it must sit strictly above this session's iat to catch it.
  revokeAllSessions(prior, "test:sign-out-all", iat + 1);
  const res = NextResponse.json({ ok: true });
  assert.deepEqual(issueSession(res, principal, { entered: false, renewing: prior }), { ok: false, reason: "revoked" });
  assert.equal(setCookie(res, SESSION_COOKIE), undefined);
  // The account itself is untouched by "sign out all devices" — which is exactly why the
  // issuer's existing re-read could never have caught this.
  const fresh = NextResponse.json({ ok: true });
  assert.equal(issueSession(fresh, principal, { entered: false }).ok, true, "a sign-in with a fresh credential still mints");
});

test("a LIVE prior session still renews, and a revocation of one device leaves the sibling minting", () => {
  const iat = Date.now();
  const { userId, prior } = renewable("revoked-sibling", iat);
  const sibling: RevocableSession = { ...prior, iat: iat + 5_000 };
  const principal: SessionPrincipal = { kind: "user", userId, workspaceId: DEFAULT_WORKSPACE_ID };

  const first = NextResponse.json({ ok: true });
  assert.equal(issueSession(first, principal, { entered: false, renewing: prior }).ok, true);
  assert.ok(setCookie(first, SESSION_COOKIE), "a live renewal sets the session cookie as it always did");

  assert.equal(revokeSession(prior, "test:one-device"), true);
  const revoked = NextResponse.json({ ok: true });
  assert.equal(issueSession(revoked, principal, { entered: false, renewing: prior }).ok, false);

  const other = NextResponse.json({ ok: true });
  const r = issueSession(other, principal, { entered: false, renewing: sibling });
  assert.equal(r.ok, true, "revoking one device does not sign the other one out");
  assert.ok(verifySession(cookieValue(other, SESSION_COOKIE)), "…and its fresh token verifies");
});

// ---- 9. Source ratchet: a renewal door names its prior session ----------------------
//
// The reason the check lives in the issuer at all is that a FUTURE cookie-to-cookie
// renewal door could leave it out and no test would notice. This is that test: a file
// that both verifies a session and mints one is renewing, and it must say so.

/** The argument text of every `issueSession(...)` call in `code`, by paren balance —
 *  a regex cannot see where a call with a nested object literal ends. */
function issueSessionCalls(code: string): string[] {
  const out: string[] = [];
  const needle = /\bissueSession\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = needle.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

test("every app/ file that both verifies and issues a session passes renewing: to the issuer", () => {
  const renewalDoors: string[] = [];
  const offenders: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, "app"))) {
    const rel = path.relative(ROOT, file);
    if (rel === ISSUER) continue;
    const code = stripComments(readFileSync(file, "utf8"));
    if (!/\bverifySession\s*\(/.test(code) || !/\bissueSession\s*\(/.test(code)) continue;
    renewalDoors.push(rel);
    if (!issueSessionCalls(code).every((args) => /\brenewing\s*:/.test(args))) offenders.push(rel);
  }
  // Fail if it matches nothing: a ratchet that checks zero files passes forever.
  assert.ok(
    renewalDoors.includes(path.join("app", "api", "auth", "switch-workspace", "route.ts")),
    `the known renewal door must be in the set — found: ${renewalDoors.join(", ") || "(none)"}`,
  );
  assert.deepEqual(offenders, [], "a renewal door minted without naming its prior session — pass renewing: so the issuer can refuse a revoked one");
});

test("the renewal ratchet reads a call's arguments by paren balance (shape fixture)", () => {
  assert.deepEqual(issueSessionCalls(`issueSession(res, p, { entered: false, renewing: s })`), [`res, p, { entered: false, renewing: s }`]);
  assert.deepEqual(issueSessionCalls(`issueSession(res, { kind: "user", userId: f(x) }, { entered: false })`), [
    `res, { kind: "user", userId: f(x) }, { entered: false }`,
  ]);
  assert.ok(!issueSessionCalls(`issueSession(res, p, { entered: false })`).every((a) => /\brenewing\s*:/.test(a)));
});
