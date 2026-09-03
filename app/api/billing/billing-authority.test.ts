// WHO MAY SPEND THE ORG'S MONEY — the three billing doors, driven for real against a
// throwaway SQLite file with the operator password SET (so authority is actually a
// decision and not open dev mode's blanket owner).
//
// The gap this closes. roles.ts defines `org:manage` as, verbatim, "billing, org
// profile/settings, delete org — owner only". Neither billing door called it: both
// checkout and portal asked `requireOperator()`, which answers "is there a valid
// session on this deployment?" — a question every recruiter, hiring manager and
// viewer also answers yes to. So any member could start a checkout that charges the
// org's card, and mint a merchant-of-record portal URL that CANCELS the subscription
// and lists invoices. GET /api/billing had no handler gate at all, so the org's plan,
// its metered burn and its prepaid credit balance were readable by any seat.
//
// This file lives apart from billing-routes.test.ts because the two need opposite
// environments: that one runs in open mode (every caller folds to owner) to exercise
// the checkout state machine; this one needs KP_OPERATOR_PASSWORD set, and the env is
// read at module scope by the auth helpers.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below). Without it `connection()` is a
// no-op only by accident of this worktree's node_modules junction.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so `cookies()` throws and the
// auth helpers degrade to "no session". These tests are ABOUT the authority decision,
// so resolve `next/headers` to a virtual module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpBillingTestCookie?: () => string | null }).__kpBillingTestCookie = () => cookieValue;
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
            const value = globalThis.__kpBillingTestCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_SECRET = "billing-authority-test-secret";
process.env.KP_OPERATOR_PASSWORD = "billing-authority-test-password";

const { GET: overviewRoute } = await import("./route.ts");
const { POST: checkoutRoute } = await import("./checkout/route.ts");
const { POST: portalRoute } = await import("./portal/route.ts");
const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default"; // the seeded org the default workspace belongs to
const team = createWorkspace("Billing team", ORG);

const owner = createUser({ orgId: ORG, email: "bill.owner@csas.cz", name: "Bill Owner", status: "active", password: "owner-pw-1234" });
const recruiter = createUser({ orgId: ORG, email: "bill.rec@csas.cz", name: "Bill Rec", status: "active", password: "rec-pw-12345" });
const viewer = createUser({ orgId: ORG, email: "bill.view@csas.cz", name: "Bill View", status: "active", password: "view-pw-1234" });
upsertMembership(owner.id, team.id, "owner");
upsertMembership(recruiter.id, team.id, "recruiter");
upsertMembership(viewer.id, team.id, "viewer");

/** Sign in as a real user (null ⇒ no session cookie at all). */
function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const checkoutReq = (body: unknown): NextRequest =>
  new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const portalReq = (): NextRequest =>
  new Request("http://localhost/api/billing/portal", { method: "POST" }) as unknown as NextRequest;

// ---- refusals carry a CODE, not prose --------------------------------------------

const CAPABILITY_CODE = "BILLING_ORG_MANAGE_REQUIRED";

test("a recruiter may not start a checkout — 403 with the capability code", async () => {
  signedInAs(recruiter);
  const res = await checkoutRoute(checkoutReq({ plan: "starter" }));
  assert.equal(res.status, 403, "pipeline:write is not org:manage — a recruiter cannot charge the org's card");
  assert.equal((await res.json()).code, CAPABILITY_CODE);
});

test("a recruiter may not mint a customer-portal URL — 403 with the capability code", async () => {
  signedInAs(recruiter);
  const res = await portalRoute(portalReq());
  assert.equal(res.status, 403, "the portal cancels the subscription and lists invoices");
  assert.equal((await res.json()).code, CAPABILITY_CODE);
});

test("a viewer may not read the billing overview — 403 with the capability code", async () => {
  signedInAs(viewer);
  const res = await overviewRoute();
  assert.equal(res.status, 403, "the plan, the metered burn and the credit balance are owner information");
  assert.equal((await res.json()).code, CAPABILITY_CODE);
});

// ---- unauthenticated stays 401 ---------------------------------------------------

test("no session at all is 401 on every billing door — never the 403 that implies a seat", async () => {
  signedInAs(null);
  assert.equal((await overviewRoute()).status, 401);
  assert.equal((await checkoutRoute(checkoutReq({ plan: "starter" }))).status, 401);
  assert.equal((await portalRoute(portalReq())).status, 401);
});

// ---- the owner still gets through ------------------------------------------------

test("an owner passes the gate on all three doors", async () => {
  signedInAs(owner);
  // No POLAR_* env here, so a door that PASSES the gate lands on the configuration
  // refusal — which is the proof it passed. A gate failure would answer 401/403.
  const checkout = await checkoutRoute(checkoutReq({ plan: "starter" }));
  assert.equal(checkout.status, 503);
  assert.equal((await checkout.json()).code, "BILLING_NOT_CONFIGURED");

  const portal = await portalRoute(portalReq());
  assert.equal(portal.status, 503);
  assert.equal((await portal.json()).code, "BILLING_NOT_CONFIGURED");

  const overview = await overviewRoute();
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).configured, false);
});

// ---- an operator-password session is still the whole deployment's owner ----------

test("the operator-password session (no per-user identity) keeps full billing authority", async () => {
  cookieValue = signSession(team.id, Date.now(), { op: true });
  const res = await overviewRoute();
  assert.equal(res.status, 200, "a single-operator self-hosted install must be unchanged");
});
