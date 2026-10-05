// The binary half of the authorization layer — "is this a trusted operator?" — and
// until now the file that decides it had NO test at all. `isOperator()` is what the
// public JD page asks before rendering Edit/Archive/Revert, and `requireOperator()`
// is the defense-in-depth gate on the routes that write provider secrets and spawn
// Python. Its contract is not obvious (open mode is a YES; a valid demo cookie is a
// NO), and every clause of it was previously held by prose alone.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// `next/headers` needs a Next request scope; `next/server` resolves to two module
// identities through a worktree's node_modules junction (see next-server-shim.mjs).
// Redirect both before the modules under test are dynamically imported.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
const NEXT_SERVER_SHIM = new URL("../testing/next-server-shim.mjs", import.meta.url).href;
let cookieValue: string | null = null;
(globalThis as { __kpOperatorCookie?: () => string | null }).__kpOperatorCookie = () => cookieValue;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    if (specifier === "next/server") return { url: NEXT_SERVER_SHIM, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpOperatorCookie();
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

process.env.KP_SECRET = "require-operator-test-secret";

const { isOperator, requireOperator } = await import("./require-operator.ts");
const { signSession, DEMO_WORKSPACE, SESSION_TTL_MS } = await import("./session.ts");
const { createUser, setUserStatus } = await import("../db/users.ts");
const { DEFAULT_ORG_ID } = await import("../db/organizations.ts");
const { requireHomeOrgReader } = await import("./require-operator.ts");

after(() => cleanupUnitDb());

const TEAM = "ws_operator_test";
function withCookie(token: string | null): void {
  cookieValue = token;
}
function passwordMode(on: boolean): void {
  if (on) process.env.KP_OPERATOR_PASSWORD = "operator-test-password";
  else delete process.env.KP_OPERATOR_PASSWORD;
}

test("OPEN MODE (no operator password) trusts every caller — the local-dev contract", async () => {
  passwordMode(false);
  withCookie(null);
  assert.equal(await isOperator(), true);
  assert.equal(await requireOperator(), null, "no gate to fail when the app itself is open");
});

test("password mode with no cookie is a 401, not a crash", async () => {
  passwordMode(true);
  withCookie(null);
  assert.equal(await isOperator(), false);
  const denied = await requireOperator();
  assert.equal(denied?.status, 401);
  assert.deepEqual(await denied?.json(), { error: "Unauthorized" });
});

test("a forged or tampered cookie is a 401", async () => {
  passwordMode(true);
  const good = signSession(TEAM, Date.now(), { op: true });
  withCookie("not.a.session");
  assert.equal(await isOperator(), false);
  withCookie(good.slice(0, -3) + "aaa"); // same shape, broken signature
  assert.equal(await isOperator(), false);
  assert.equal((await requireOperator())?.status, 401);
});

test("an EXPIRED session is a 401 — the signature alone is never enough", async () => {
  passwordMode(true);
  withCookie(signSession(TEAM, Date.now() - SESSION_TTL_MS - 60_000, { op: true }));
  assert.equal(await isOperator(), false);
});

test("a valid operator session passes", async () => {
  passwordMode(true);
  withCookie(signSession(TEAM, Date.now(), { op: true }));
  assert.equal(await isOperator(), true);
  assert.equal(await requireOperator(), null);
});

test("a signed-in MEMBER passes too — this gate is proxy-equivalent, not owner-only", async () => {
  // Deliberate: requireOperator mirrors proxy.ts ("any valid session"), and the
  // per-user question is current-user.ts's requireCapability. A test that demanded
  // 403 here would be pinning a policy this file does not implement.
  passwordMode(true);
  const member = createUser({ orgId: DEFAULT_ORG_ID, email: "op.member@example.test", name: "Member" });
  withCookie(signSession(TEAM, Date.now(), { sub: member.id, org: "org-default", role: "recruiter" }));
  assert.equal(await isOperator(), true);
});

test("an OFFBOARDED member's still-valid cookie is refused — the account is re-read, not trusted from the token", async () => {
  // The token is stateless and lives 7 days; nothing can reach into it. What CAN be
  // withdrawn is the source it names. capabilitiesForUserInWorkspace already reads
  // users.status on every request, but this gate did not, so a disabled member kept
  // every requireOperator-only route (calibration thresholds, archetypes, calendar
  // connect, …) until the cookie expired — the console said "disabled" and the
  // cookie said otherwise.
  passwordMode(true);
  const leaver = createUser({ orgId: DEFAULT_ORG_ID, email: "op.leaver@example.test", name: "Leaver" });
  withCookie(signSession(TEAM, Date.now(), { sub: leaver.id, org: DEFAULT_ORG_ID, role: "recruiter" }));
  assert.equal(await isOperator(), true, "active: signed in");
  setUserStatus(leaver.id, "disabled");
  assert.equal(await isOperator(), false, "disabled: the same cookie, byte for byte, no longer signs anyone in");
  assert.equal((await requireOperator())?.status, 401);
  assert.equal((await requireHomeOrgReader())?.status, 401, "and the home-org reads go with it");
  withCookie(signSession(TEAM, Date.now(), { sub: "usr_deleted_since_mint", org: DEFAULT_ORG_ID, role: "owner" }));
  assert.equal(await isOperator(), false, "a sub that names no account is nobody, not a member");
  withCookie(signSession(TEAM, Date.now(), { op: true }));
  assert.equal(await isOperator(), true, "the identity-less operator session has no row to re-read and is unchanged");
});

test("CRITICAL: an anonymous DEMO session is signed, valid — and not an operator", async () => {
  // /api/demo is public and mints a real signature for the "demo" workspace, so the
  // proxy lets it through. Without this clause that anonymous cookie would satisfy
  // the whole-DB export/import routes: an exfiltration channel anyone could open.
  passwordMode(true);
  withCookie(signSession(DEMO_WORKSPACE, Date.now(), {}));
  assert.equal(await isOperator(), false);
  assert.equal((await requireOperator())?.status, 401);
});

test("a demo session is still refused when it carries identity claims", async () => {
  passwordMode(true);
  withCookie(signSession(DEMO_WORKSPACE, Date.now(), { sub: "usr_x", org: "org-default", op: true }));
  assert.equal(await isOperator(), false, "the WORKSPACE decides this, not the claims");
});

// ── The HOME-ORG tier (challenge-r03 platform-auth-api/A) ───────────────────────
// isOperator() answers "signed in and not demo", which every member of EVERY org
// satisfies. The deployment-wide reads (/api/ops, the /api/health detail, the
// llm_usage ledger, /diagrams) count every tenant's rows, so their caller must belong
// to the install's HOME org. Single-org installs are unchanged: with signup off every
// session carries org in {absent, "org-default"}.

const { homeOrgReader, isHomeOrgReader, HOME_ORG_ID } = await import("./require-operator.ts");
const { verifySession } = await import("./session.ts");

const PASSWORD_ENV = { KP_OPERATOR_PASSWORD: "set" } as unknown as NodeJS.ProcessEnv;
const session = (claims: Parameters<typeof signSession>[2], ws: string = TEAM) => verifySession(signSession(ws, Date.now(), claims));

test("HOME_ORG_ID is the seeded home org, not a second spelling of it", () => {
  assert.equal(HOME_ORG_ID, DEFAULT_ORG_ID);
});

test("homeOrgReader: the pure predicate, clause by clause", () => {
  assert.equal(homeOrgReader(null, {} as NodeJS.ProcessEnv), true, "open mode trusts every caller");
  assert.equal(homeOrgReader(null, PASSWORD_ENV), false, "no session");
  assert.equal(homeOrgReader(session({ op: true }), PASSWORD_ENV), true, "the password operator");
  assert.equal(homeOrgReader(session({}), PASSWORD_ENV), true, "claim-less legacy operator cookie, unchanged");
  assert.equal(homeOrgReader(session({ sub: "usr_b", org: "org-b", role: "owner" }), PASSWORD_ENV), false, "an owner of ANOTHER org");
  assert.equal(homeOrgReader(session({ sub: "usr_n", role: "recruiter" }), PASSWORD_ENV), true, "sub with no org claim");
  assert.equal(homeOrgReader(session({ sub: "usr_h", org: "org-default", role: "viewer" }), PASSWORD_ENV), true, "any seat of the home org");
  assert.equal(homeOrgReader(session({ op: true }, DEMO_WORKSPACE), PASSWORD_ENV), false, "demo is never a reader");
  assert.equal(homeOrgReader(session({}, DEMO_WORKSPACE), PASSWORD_ENV), false);
});

test("requireHomeOrgReader: 401 without a session, a CODED 403 for another org, null for home", async () => {
  passwordMode(true);
  // Real accounts: the gate re-reads the account a cookie names, so a sub with no row is nobody.
  const otherOwner = createUser({ orgId: "org-b", email: "op.b-owner@example.test", name: "B Owner" });
  const homeSeat = createUser({ orgId: DEFAULT_ORG_ID, email: "op.home-seat@example.test", name: "Home Seat" });
  withCookie(null);
  assert.equal((await requireHomeOrgReader())?.status, 401);
  withCookie(signSession(DEMO_WORKSPACE, Date.now(), {}));
  assert.equal((await requireHomeOrgReader())?.status, 401, "demo stays the 401 it is today");
  withCookie(signSession(TEAM, Date.now(), { sub: otherOwner.id, org: "org-b", role: "owner" }));
  assert.equal(await isOperator(), true, "still signed in — that part is unchanged");
  assert.equal(await isHomeOrgReader(), false);
  const denied = await requireHomeOrgReader();
  assert.equal(denied?.status, 403);
  const body = (await denied?.json()) as { error?: string; code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  // Spelled inline (api-response.ts stays out of this module's graph), so pin it to
  // the registry: the shape must be exactly what jsonRefusal would have answered.
  const { REFUSAL_ERRORS } = await import("../api-response.ts");
  assert.equal(body.error, REFUSAL_ERRORS.FORBIDDEN_CAPABILITY);
  assert.equal(body.capability, "deployment:read");
  withCookie(signSession(TEAM, Date.now(), { sub: homeSeat.id, org: "org-default", role: "recruiter" }));
  assert.equal(await requireHomeOrgReader(), null);
  passwordMode(false);
  withCookie(signSession(TEAM, Date.now(), { sub: otherOwner.id, org: "org-b", role: "owner" }));
  assert.equal(await requireHomeOrgReader(), null, "open mode has no gate to fail");
});

// ── Revocation reaches the HOME-ORG tier too ─────────────────────────────────────
// isOperator() has consulted the revocation list since the store shipped; this tier did
// NOT, and it is the one surface that is reachable WITHOUT requireOperator above it:
// /diagrams and the palette preview's deployment-wide tabs ask isHomeOrgReader() alone.
// proxy.ts was therefore the only check a revoked cookie met on that path, and its own
// revocation lookup fails open when its dynamic import does — so a revoked session kept
// the deployment-wide reads. A revoked session reads as NO reader.

const { revokeSession } = await import("./session-revocation.ts");

test("a REVOKED home-org session is not a reader — and the live sibling device still is", async () => {
  passwordMode(true);
  const seat = createUser({ orgId: DEFAULT_ORG_ID, email: "op.revoked-seat@example.test", name: "Revoked Seat" });
  const stolenAt = Date.now();
  const stolen = signSession(TEAM, stolenAt, { sub: seat.id, org: DEFAULT_ORG_ID, role: "recruiter" });
  const stillMine = signSession(TEAM, stolenAt + 1_000, { sub: seat.id, org: DEFAULT_ORG_ID, role: "recruiter" });

  // Probe first: both cookies really are readers, so the refusal below cannot be a
  // signature, expiry or org failure wearing a revocation's clothes.
  withCookie(stolen);
  assert.equal(await isHomeOrgReader(), true, "probe: a live home-org seat IS a reader");
  withCookie(stillMine);
  assert.equal(await isHomeOrgReader(), true, "probe: so is the second device");

  revokeSession({ workspace: TEAM, sub: seat.id, iat: stolenAt }, "test:stolen-laptop", stolenAt);

  withCookie(stolen);
  assert.equal(await isHomeOrgReader(), false, "the revoked cookie must lose the deployment-wide reads");
  assert.equal((await requireHomeOrgReader())?.status, 401, "and requireOperator refuses it first");

  withCookie(stillMine);
  assert.equal(await isHomeOrgReader(), true, "a targeted revocation signs out one device, not the seat");
});

test("open mode is unchanged by a revocation — the local-dev contract outranks it", async () => {
  // isHomeOrgReader's first line is the open-mode early return, so there is no session
  // to revoke: with no KP_OPERATOR_PASSWORD the app runs open by design.
  const seat = createUser({ orgId: DEFAULT_ORG_ID, email: "op.open-mode@example.test", name: "Open Seat" });
  const iat = Date.now();
  passwordMode(true);
  withCookie(signSession(TEAM, iat, { sub: seat.id, org: DEFAULT_ORG_ID, role: "recruiter" }));
  revokeSession({ workspace: TEAM, sub: seat.id, iat }, "test:open-mode", iat);
  assert.equal(await isHomeOrgReader(), false, "probe: revoked while the password is set");
  passwordMode(false);
  assert.equal(await isHomeOrgReader(), true, "open mode trusts every caller, revoked or not");
  withCookie(null);
  assert.equal(await isHomeOrgReader(), true, "including one with no cookie at all");
});
