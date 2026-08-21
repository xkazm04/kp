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
import { creditBalance, getBillingState, upsertBillingState } from "../../_lib/db/billing.ts";

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
      // Corrupt by flipping the first char to a DIFFERENT one: `replace(/^./, "A")` was a
      // no-op whenever the base64 MAC already began with "A" (~1 in 64 runs), and the
      // "reject a bad signature" test below then delivered a genuinely VALID signature
      // and asserted 400 against a real 200. A guard that silently tests nothing at that
      // rate is worse than no guard.
      "webhook-signature": `v1,${opts?.corruptSignature ? (mac[0] === "A" ? "B" : "A") + mac.slice(1) : mac}`,
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

test("checkout: the Enterprise contact-sales tier is rejected 400 and never hits the provider", async () => {
  configurePolarEnv();
  const originalFetch = globalThis.fetch;
  let providerHit = false;
  globalThis.fetch = (async () => {
    providerHit = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "enterprise" }) })
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /sales/i, "should point the buyer at sales, not a generic error");
    assert.equal(providerHit, false, "a contact-sales plan must never reach the payment gateway");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout happy path returns the provider-hosted URL (provider hop stubbed)", async () => {
  configurePolarEnv();
  // Precondition: a NON-subscriber (the legitimate first-checkout path). Earlier
  // tests in this shared DB entitled a subscription; the server-side guard would
  // (correctly) 403 a plan checkout while one is live, so start from free here.
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
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

test("checkout: an existing subscriber is blocked 403 and pointed at the portal (no provider hop)", async () => {
  configurePolarEnv();
  // A live subscription exists — a stale tab or a crafted raw POST must NOT mint a
  // second, parallel subscription (double-charge). The server, not just the client
  // `changeVia` hint, enforces the portal-only-for-changes invariant.
  upsertBillingState({ plan: "starter", status: "active", provider: "polar", providerSubscriptionId: "sub_live" });
  const originalFetch = globalThis.fetch;
  let providerHit = false;
  globalThis.fetch = (async () => {
    providerHit = true;
    return new Response(JSON.stringify({ url: "https://polar.test/checkout/co_x", id: "co_x" }), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "growth" }) })
    );
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /portal/i);
    assert.equal(providerHit, false, "an already-subscribed checkout must never reach the payment gateway");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout: a pack top-up is still allowed for an existing subscriber (one-time, sold on any tier)", async () => {
  configurePolarEnv();
  upsertBillingState({ plan: "starter", status: "active", provider: "polar", providerSubscriptionId: "sub_live" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ url: "https://polar.test/checkout/co_pack", id: "co_pack" }), { status: 200 })) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ pack: "minutes_100" }) })
    );
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- the "already subscribed" guard must not outlive the subscription ------------
//
// The guard reads the RAW stored status (hasActiveSubscription), while entitlement
// reads the same row through entitledPlan, which BOUNDS `canceled` by currentPeriodEnd.
// A cancel-at-period-end whose terminal `revoked` never arrived therefore lands on free
// entitlement AND a 403'd checkout: stranded, with a portal that has nothing left to
// change. These three pin the seam in both directions.

test("checkout: a canceled subscription past its paid period can re-subscribe (not stranded on free)", async () => {
  configurePolarEnv();
  upsertBillingState({
    plan: "starter",
    status: "canceled",
    provider: "polar",
    providerSubscriptionId: "sub_lapsed",
    providerCustomerId: "cus_unit_1",
    currentPeriodEnd: "2020-01-01T00:00:00Z",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ url: "https://polar.test/checkout/co_back", id: "co_back" }), { status: 200 })) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "starter" }) })
    );
    assert.equal(res.status, 200, "entitlement already lapsed to free — the portal cannot sell them anything");
    assert.equal((await res.json()).url, "https://polar.test/checkout/co_back");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout: a canceled subscription still INSIDE its paid period stays portal-only", async () => {
  configurePolarEnv();
  upsertBillingState({
    plan: "starter",
    status: "canceled",
    provider: "polar",
    providerSubscriptionId: "sub_grace",
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString(),
  });
  const originalFetch = globalThis.fetch;
  let providerHit = false;
  globalThis.fetch = (async () => {
    providerHit = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "growth" }) })
    );
    assert.equal(res.status, 403, "still entitled and still billing — a second checkout would run in parallel");
    assert.equal(providerHit, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout: a lapsed FAILED-payment subscription is NOT relaxed — the MoR is still dunning it", async () => {
  configurePolarEnv();
  // past_due beyond the 7-day dunning grace: entitlement is free, but the subscription
  // is LIVE at the provider. Relaxing this one would mint a parallel sub and double-charge.
  upsertBillingState({
    plan: "growth",
    status: "past_due",
    provider: "polar",
    providerSubscriptionId: "sub_dunning",
    currentPeriodEnd: "2020-01-01T00:00:00Z",
  });
  const originalFetch = globalThis.fetch;
  let providerHit = false;
  globalThis.fetch = (async () => {
    providerHit = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "starter" }) })
    );
    assert.equal(res.status, 403);
    assert.equal(providerHit, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkout: a WITHDRAWN (legacy) tier is refused with its own reason, not the contact-sales one", async () => {
  configurePolarEnv();
  // BYOM is `legacy` (withdrawn 2026-08-19), not `contactSales`. Both fail
  // isSelfServePlan, so a single shared message told a would-be BYOM buyer that
  // "Enterprise is a custom, contact-sales plan" — a plan they never asked about.
  const res = await checkoutPost(
    new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "byom" }) })
  );
  assert.equal(res.status, 400);
  const { error } = (await res.json()) as { error: string };
  assert.doesNotMatch(error, /enterprise|contact-sales/i, "a withdrawn tier must not be described as contact-sales");
  assert.match(error, /BYOM/, "name the tier the caller actually asked for");
});
