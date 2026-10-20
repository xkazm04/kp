// The billing alert READER on the wire (challenge-r05 billing-plan-and-spend/A):
// GET /api/billing gains `alerts`, and POST /api/billing/alerts/[id] resolves one
// with a KIND (fixed | dismissed) behind the owner-only billing door.
//
// Three things are pinned here:
//   1. WIRE PARITY — every key GET /api/billing answered before this change still
//      answers the same value (against a committed golden, not "the response captured
//      before": once the code changes, that comparand is gone).
//   2. THE RESOLVE DOOR — its whole refusal vocabulary, coded.
//   3. CHARGE PARITY, a declared GUARD case: a scripted three-org replay of the four
//      money tables + billingOverview + meterAllowance + a meterGate 402 probe is
//      snapshotted against app/_lib/billing/__fixtures__/charge-parity.json, then
//      every alert is read and resolved, and the snapshot must still be byte-identical.
//      The reader writes ONLY billing_alerts; this is what proves it. A guard case is
//      green before the change by design — it is here to stay green.
//
// Regenerate the golden ONLY for a deliberate charge change (and say so in the commit):
//   KP_WRITE_CHARGE_PARITY=1 node --import ./scripts/test-alias-loader.mjs ... --test <this file>
//
// Runs with the operator password SET (authority is a decision, not open dev mode) and
// with metering ON (a provider credential), so the allowances are real numbers.
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpBillingAlertsCookie?: () => string | null }).__kpBillingAlertsCookie = () => cookieValue;
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
            const value = globalThis.__kpBillingAlertsCookie();
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

process.env.KP_SECRET = "billing-alerts-test-secret";
process.env.KP_OPERATOR_PASSWORD = "billing-alerts-test-password";
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { GET: overviewRoute } = await import("./route.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");
const billingStore = await import("../../_lib/db/billing.ts");
const { entitledPlan } = await import("../../_lib/billing/index.ts");
// The replay, the snapshot and the golden live beside charge-parity.json, shared with
// every other card that has to prove it moved no charge (allowance-window.test.ts).
const parity = await import("../../_lib/billing/__fixtures__/charge-parity-replay.ts");

after(() => cleanupUnitDb());

const fx = parity.chargeParityFixture();
const ORG_A = fx.orgA;
const orgB = { id: fx.orgB };
const { teamA, teamB } = fx;

const ownerA = createUser({ orgId: ORG_A, email: "alerts.owner.a@csas.cz", name: "Owner A", status: "active", password: "owner-a-pw-1234" });
const recruiterA = createUser({ orgId: ORG_A, email: "alerts.rec.a@csas.cz", name: "Rec A", status: "active", password: "rec-a-pw-12345" });
const ownerB = createUser({ orgId: orgB.id, email: "alerts.owner.b@example.com", name: "Owner B", status: "active", password: "owner-b-pw-1234" });
upsertMembership(ownerA.id, teamA.id, "owner");
upsertMembership(recruiterA.id, teamA.id, "recruiter");
upsertMembership(ownerB.id, teamB.id, "owner");

type Who = { id: string; orgId: string } | null;
function signedInAs(user: Who, workspace: string): void {
  cookieValue = user === null ? null : signSession(workspace, Date.now(), { sub: user.id, org: user.orgId });
}

type ResolveRoute = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
async function resolveRoute(): Promise<ResolveRoute> {
  // Loaded lazily: the door is new, and the golden half of the guard case must be
  // able to run (and be regenerated) on a tree that does not have it yet.
  const mod = (await import("./alerts/[id]/route.ts")) as { POST: ResolveRoute };
  return mod.POST;
}
async function resolve(id: number | string, body: unknown): Promise<Response> {
  const POST = await resolveRoute();
  const req = new Request(`http://localhost/api/billing/alerts/${id}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req, { params: Promise.resolve({ id: String(id) }) });
}

const PRE_EXISTING_KEYS = ["plan", "status", "periodEnd", "provider", "metered", "meters", "configured", "catalog"] as const;
function preExisting(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PRE_EXISTING_KEYS.map((k) => [k, body[k]]));
}

const golden = parity.readChargeParityGolden();
const writing = process.env.KP_WRITE_CHARGE_PARITY === "1";
const written: { freshGet?: Record<string, unknown>; replay?: unknown } = {};

// ---- 1. wire parity on a fresh DB --------------------------------------------------

test("wire parity: a fresh DB answers alerts: [] and every pre-existing key unchanged", async () => {
  signedInAs(ownerA, teamA.id);
  const res = await overviewRoute();
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  if (writing) written.freshGet = preExisting(body);
  else {
    assert.ok(golden, "the committed golden is missing");
    assert.deepEqual(preExisting(body), golden.freshGet, "a pre-existing GET /api/billing key moved");
  }
  assert.deepEqual(body.alerts, [], "a fresh DB has nothing to report");
});

// ---- 2. charge parity (GUARD case) --------------------------------------------------

const NOW = parity.CHARGE_PARITY_NOW;
const replay = (): void => parity.replayChargeParity(fx, NOW);
const moneySnapshot = (): unknown => parity.chargeParitySnapshot(fx, NOW);

test("charge parity (GUARD): reading and resolving every alert moves no money state", async () => {
  replay();
  const before = JSON.stringify(moneySnapshot(), null, 2);
  if (writing) {
    written.replay = JSON.parse(before);
    writeFileSync(parity.CHARGE_PARITY_GOLDEN, `${JSON.stringify(written, null, 2)}\n`);
  } else {
    assert.ok(golden, "the committed golden is missing");
    assert.equal(before, JSON.stringify(golden.replay, null, 2), "the scripted money history no longer reproduces the golden");
  }
  // The replay must actually exercise a 402: B has spent its pack dry.
  const b = (JSON.parse(before) as { orgs: Array<{ org: string; gate: unknown }> }).orgs.find((o) => o.org === "org-B");
  assert.ok(b?.gate, "org B's interview-minute gate must refuse (the 402 probe)");

  // Read every alert through the door an owner uses, then resolve every one.
  signedInAs(ownerA, teamA.id);
  const a = (await (await overviewRoute()).json()) as { alerts: Array<{ id: number; code: string; detail?: string }> };
  assert.deepEqual(a.alerts.map((x) => x.code).sort(), ["price_drift", "unmapped_product"]);
  assert.ok(a.alerts.every((x) => typeof x.detail === "string"), "the home-org owner reads the provider detail");
  for (const [i, alert] of a.alerts.entries()) {
    const res = await resolve(alert.id, { resolution: i === 0 ? "fixed" : "dismissed" });
    assert.equal(res.status, 200);
  }
  signedInAs(ownerB, teamB.id);
  const bBody = (await (await overviewRoute()).json()) as { alerts: Array<{ id: number; code: string; detail?: string }> };
  assert.deepEqual(bBody.alerts.map((x) => x.code), ["unmapped_product"], "org B sees its own alert and no price_drift");
  assert.equal("detail" in bBody.alerts[0], false, "an org owner is never handed the provider detail");
  assert.equal((await resolve(bBody.alerts[0].id, { resolution: "fixed" })).status, 200);

  assert.equal(billingStore.listBillingAlerts().length, 0, "every alert is resolved");
  const after = JSON.stringify(moneySnapshot(), null, 2);
  assert.equal(after, before, "resolving alerts moved money state");
  assert.equal(entitledPlan(billingStore.getBillingState(orgB.id), NOW).id, "free", "resolving a dark subscription never entitles it");
});

// ---- 3. the resolve door ------------------------------------------------------------

test("resolve door: kinded, CAS-guarded, org-scoped, owner-only, coded", async () => {
  billingStore.recordBillingAlert({ orgId: orgB.id, kind: "unmapped_product", detail: "door: b", providerRef: "sub_door_b" });
  billingStore.recordBillingAlert({ orgId: ORG_A, kind: "unmapped_product", detail: "door: a", providerRef: "sub_door_a" });
  const bId = billingStore.listBillingAlertsForOrg(orgB.id)[0].id;
  const aId = billingStore.listBillingAlertsForOrg(ORG_A)[0].id;

  signedInAs(null, teamB.id);
  assert.equal((await resolve(bId, { resolution: "fixed" })).status, 401);

  signedInAs(recruiterA, teamA.id);
  const rec = await resolve(aId, { resolution: "fixed" });
  assert.equal(rec.status, 403);
  assert.equal(((await rec.json()) as { code: string }).code, "BILLING_ORG_MANAGE_REQUIRED");

  signedInAs(ownerB, teamB.id);
  const bogus = await resolve(bId, { resolution: "bogus" });
  assert.equal(bogus.status, 400);
  assert.equal(((await bogus.json()) as { code: string }).code, "BILLING_ALERT_RESOLUTION_INVALID");

  const foreign = await resolve(aId, { resolution: "fixed" });
  assert.equal(foreign.status, 404, "another org's alert answers exactly what an unknown id answers");
  assert.equal(((await foreign.json()) as { code: string }).code, "BILLING_ALERT_NOT_FOUND");
  assert.equal((await resolve(999_999, { resolution: "fixed" })).status, 404);
  assert.equal((await resolve("not-a-number", { resolution: "fixed" })).status, 404);

  const ok = await resolve(bId, { resolution: "fixed" });
  assert.equal(ok.status, 200);
  const row = billingStore.listBillingAlertsForOrg(orgB.id, { includeResolved: true }).find((r) => r.id === bId);
  assert.ok(row?.resolvedAt, "resolved_at is stamped");
  assert.equal(row?.resolution, "fixed");

  const again = await resolve(bId, { resolution: "dismissed" });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { code: string }).code, "BILLING_ALERT_NOT_OPEN");
  assert.equal(
    billingStore.listBillingAlertsForOrg(orgB.id, { includeResolved: true }).find((r) => r.id === bId)?.resolution,
    "fixed",
    "a second call never re-kinds a closed alert"
  );
});
