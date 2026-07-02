// Handler-level coverage for the money routes against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import; it also clears every
// POLAR_* env so each test opts in explicitly):
//   POST /api/billing/webhook  — THE only write path for money state: signature
//     gate, idempotency on the provider event id, plan entitlement, pack credits
//   POST /api/billing/checkout — config/validation gates + the provider hop
// The webhook fixtures are real standard-webhooks signatures (HMAC-SHA256 over
// `${id}.${timestamp}.${body}`), so the verify path runs for real.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as webhookPost } from "./webhook/route.ts";
import { POST as checkoutPost } from "./checkout/route.ts";
import { creditBalance, getBillingState } from "../../_lib/db/billing.ts";

after(() => cleanupUnitDb());

const SECRET_KEY = Buffer.from("unit-test-webhook-secret");
const PRODUCT_STARTER = "prod_starter_unit";
const PRODUCT_PACK = "prod_pack_unit";

function configurePolarEnv(): void {
  process.env.POLAR_ACCESS_TOKEN = "unit-test-token";
  process.env.POLAR_WEBHOOK_SECRET = `whsec_${SECRET_KEY.toString("base64")}`;
  process.env.POLAR_PRODUCT_STARTER = PRODUCT_STARTER;
  process.env.POLAR_PRODUCT_MINUTE_PACK = PRODUCT_PACK;
}
function clearPolarEnv(): void {
  for (const k of ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_PRODUCT_STARTER", "POLAR_PRODUCT_MINUTE_PACK"]) {
    delete process.env[k];
  }
}
afterEach(() => clearPolarEnv());

/** A correctly signed webhook request for `payload`, delivered as event `id`. */
function signedWebhook(id: string, payload: unknown, opts?: { corruptSignature?: boolean }): NextRequest {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const mac = crypto.createHmac("sha256", SECRET_KEY).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${opts?.corruptSignature ? mac.replace(/^./, "A") : mac}`,
    },
  });
}

const subscriptionActive = {
  type: "subscription.active",
  data: {
    id: "sub_unit_1",
    status: "active",
    product_id: PRODUCT_STARTER,
    customer_id: "cus_unit_1",
    current_period_start: "2026-07-01T00:00:00Z",
    current_period_end: "2026-08-01T00:00:00Z",
  },
};

test("webhook without billing configured → 503 (provider will retry once env is fixed)", async () => {
  const res = await webhookPost(signedWebhook("evt_unconfigured", subscriptionActive));
  assert.equal(res.status, 503);
});

test("webhook with a bad signature → 400 and NO money state written", async () => {
  configurePolarEnv();
  const res = await webhookPost(signedWebhook("evt_bad_sig", subscriptionActive, { corruptSignature: true }));
  assert.equal(res.status, 400);
  assert.equal(getBillingState(), null, "an unverified delivery must never touch billing_state");
});

test("a verified subscription event entitles the plan; the redelivery dedupes on the event id", async () => {
  configurePolarEnv();
  const res = await webhookPost(signedWebhook("evt_sub_1", subscriptionActive));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.action, "set_subscription");
  assert.equal(body.duplicate, false);

  const state = getBillingState();
  assert.equal(state!.plan, "starter");
  assert.equal(state!.status, "active");
  assert.equal(state!.providerSubscriptionId, "sub_unit_1");

  // Same event id again (provider redelivery) → acknowledged but not re-applied.
  const redelivery = await webhookPost(signedWebhook("evt_sub_1", subscriptionActive));
  assert.equal(redelivery.status, 200);
  assert.equal((await redelivery.json()).duplicate, true);
});

test("order.paid grants pack credits ONCE per order — a redelivered order under a new event id must not double-grant", async () => {
  configurePolarEnv();
  const before = creditBalance("interview_minutes");
  const orderPaid = { type: "order.paid", data: { id: "ord_unit_1", product_id: PRODUCT_PACK, customer_id: "cus_unit_1" } };

  const res = await webhookPost(signedWebhook("evt_order_1", orderPaid));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).action, "grant_credits");
  assert.equal(creditBalance("interview_minutes"), before + 100);

  // Same ORDER on a fresh event id (retry storms do this) → the provider_ref
  // dedupe keeps the grant single.
  const retried = await webhookPost(signedWebhook("evt_order_2", orderPaid));
  assert.equal(retried.status, 200);
  assert.equal(creditBalance("interview_minutes"), before + 100, "one order may only ever grant once");

  // order.created (not yet paid) grants nothing.
  const created = await webhookPost(
    signedWebhook("evt_order_3", { type: "order.created", data: { id: "ord_unit_2", product_id: PRODUCT_PACK } })
  );
  assert.equal((await created.json()).action, "ignore");
  assert.equal(creditBalance("interview_minutes"), before + 100);
});

test("checkout: 503 when billing is unconfigured, 400 for a body naming neither plan nor pack", async () => {
  const unconfigured = await checkoutPost(
    new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "starter" }) })
  );
  assert.equal(unconfigured.status, 503);

  configurePolarEnv();
  const badBody = await checkoutPost(
    new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "free" }) })
  );
  assert.equal(badBody.status, 400);
  assert.match((await badBody.json()).error, /plan|pack/);
});

test("checkout happy path returns the provider-hosted URL (provider hop stubbed)", async () => {
  configurePolarEnv();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ url: "https://polar.test/checkout/co_1", id: "co_1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "starter" }) })
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).url, "https://polar.test/checkout/co_1");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/checkouts\/$/);
    assert.deepEqual((calls[0].body as { products: string[] }).products, [PRODUCT_STARTER]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
