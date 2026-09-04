// GET /api/me/getting-started — the first-run checklist read, previously untested.
//
// The route drives the whole derivation (app/_lib/getting-started.ts) against the
// SESSION's workspace and org, so this file pins the two things a caller can observe:
// who may ask, and that the company step now answers from the asker's own org rather
// than from deployment-wide state. companyStep's branch table lives in
// app/_lib/getting-started.test.ts; this is the wiring.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
//   node scripts/run-unit-tests.mjs "app/api/me/getting-started/*.test.ts"
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
let orgNameCookie: string | null = null;
(globalThis as { __kpGsTestCookie?: () => string | null }).__kpGsTestCookie = () => cookieValue;
(globalThis as { __kpGsTestOrgName?: () => string | null }).__kpGsTestOrgName = () => orgNameCookie;
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
            const session = globalThis.__kpGsTestCookie();
            const orgName = globalThis.__kpGsTestOrgName();
            return {
              get: (name) => {
                if (name === ${JSON.stringify(SESSION_COOKIE)} && session) return { name, value: session };
                if (name === "kp_org_name" && orgName) return { name, value: orgName };
                return undefined;
              },
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

// Password mode: the route's own gate (any signed-in non-demo member, the same
// self-service bar as POST /api/me/onboarding) only exists when one is set.
process.env.KP_SECRET = "getting-started-test-secret";
process.env.KP_OPERATOR_PASSWORD = "getting-started-test-password";

const { GET } = await import("./route.ts");
const { signSession, DEMO_WORKSPACE } = await import("../../../_lib/auth/session.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createOrganization, updateOrganization } = await import("../../../_lib/db/organizations.ts");
const { saveBrand } = await import("../../../_lib/brand-store.ts");

after(() => cleanupUnitDb());

// Two tenants on one box. `alpha` white-labels the deployment; `beta` never touches
// the brand and never names itself.
const alphaOrg = createOrganization("Alpha Hiring s.r.o.");
const betaOrg = createOrganization("Untitled organization");
const alphaTeam = createWorkspace("Alpha team", alphaOrg.id);
const betaTeam = createWorkspace("Beta team", betaOrg.id);

// The deployment-wide singleton — set once, visible to everyone, owned by nobody.
saveBrand({ displayName: "Alpha Hiring", accentColor: null, logoUrl: null });

type Body = { company?: boolean; companySignal?: string; firstRole?: string; error?: string };
const bodyOf = async (r: Response): Promise<Body> => (await r.json()) as Body;

function signedIn(workspaceId: string, orgId: string): void {
  cookieValue = signSession(workspaceId, Date.now(), { sub: "usr-test", org: orgId });
}

test("a session-less caller is refused", async () => {
  cookieValue = null;
  orgNameCookie = null;
  assert.equal((await GET()).status, 401);
});

test("a demo session has no checklist", async () => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  assert.equal((await GET()).status, 401);
});

test("tenant B does not read the tick tenant A earned", async () => {
  // The bug: the brand singleton above was set by Alpha, and Beta's checklist showed
  // its company step complete because of it.
  signedIn(betaTeam.id, betaOrg.id);
  orgNameCookie = null;
  const body = await bodyOf(await GET());
  assert.equal(body.company, false, "Beta has named nothing — the tick belonged to Alpha's brand row");
  assert.equal(body.companySignal, "org", "and the payload says which signal answered");
});

test("…and the caller's own org name completes it", async () => {
  updateOrganization(betaOrg.id, { name: "Beta Recruiting a.s." });
  signedIn(betaTeam.id, betaOrg.id);
  const body = await bodyOf(await GET());
  assert.equal(body.company, true);
  assert.equal(body.companySignal, "org");
});

test("tenant A still completes it from its own row, not from the brand", async () => {
  signedIn(alphaTeam.id, alphaOrg.id);
  const body = await bodyOf(await GET());
  assert.equal(body.company, true);
  assert.equal(body.companySignal, "org");
  assert.equal(typeof body.firstRole, "string", "the rest of the checklist still derives");
});

test("a session with no org falls back to the deployment-wide read, and labels it", async () => {
  // A legacy session minted before orgs (no `org` claim). There is no tenant-scoped
  // name to read, so the old brand/cookie signal is still the best available one —
  // and `companySignal` stops it pretending to be per-tenant.
  cookieValue = signSession(alphaTeam.id, Date.now(), { sub: "usr-test" });
  orgNameCookie = null;
  const body = await bodyOf(await GET());
  assert.equal(body.companySignal, "deployment");
  assert.equal(body.company, true, "the deployment's brand IS set, and that is what this branch reads");
});
