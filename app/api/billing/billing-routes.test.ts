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
import { POST as portalPost } from "./portal/route.ts";
import { creditBalance, getBillingState, upsertBillingState } from "../../_lib/db/billing.ts";
import { rateLimit } from "../../_lib/rate-limit.ts";

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

/** A correctly signed webhook request for `payload`, delivered as event `id`.
 *  `clientIp` rides as an `X-Forwarded-For` so the rate-limit test can address a
 *  SPECIFIC limiter bucket (only meaningful with KP_TRUSTED_PROXY set — see
 *  resolveClientIp's trust model). */
function signedWebhook(id: string, payload: unknown, opts?: { corruptSignature?: boolean; clientIp?: string }): NextRequest {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const mac = crypto.createHmac("sha256", SECRET_KEY).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...(opts?.clientIp ? { "x-forwarded-for": opts.clientIp } : {}),
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

// ---- the raw body read is BOUNDED -------------------------------------------------
//
// /api/billing/webhook is on the PUBLIC allow-list (a machine posts here, so the
// operator gate would 401 Polar), and the standard-webhooks MAC covers the body — so
// the body must be in hand BEFORE anything can be verified. `await request.text()` had
// no budget, which made an unauthenticated `curl` the first thing to allocate: any
// caller could stream hundreds of MB into the Node heap and be answered 400 only after
// it had all been buffered. Repeat that in parallel and the process dies — taking every
// real customer's webhook delivery (i.e. their plan and their credits) with it. Same
// bounded-read contract the other public machine endpoints already use
// (agents/report/[token], channels/inbound/[token] → readTextWithLimit + 413).

/** A POST whose body is STREAMED in chunks with no content-length — the shape that
 *  slips past an advisory header check and that `request.text()` would buffer whole. */
function chunkedWebhook(totalBytes: number): NextRequest {
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  const base = new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body: stream,
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_oversized",
      "webhook-timestamp": Math.floor(Date.now() / 1000).toString(),
      "webhook-signature": "v1,AAAA",
    },
    // Required by undici for a streaming request body; not yet in the DOM RequestInit type.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return new NextRequest(base);
}

test("webhook: an oversized body is refused 413 — never buffered whole before the signature check", async () => {
  configurePolarEnv();
  // (a) an honest oversized upload: the advisory content-length fast-reject.
  const declared = new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    body: "x".repeat(400 * 1024),
    headers: {
      "content-type": "application/json",
      "webhook-id": "evt_oversized_declared",
      "webhook-timestamp": Math.floor(Date.now() / 1000).toString(),
      "webhook-signature": "v1,AAAA",
    },
  });
  assert.equal((await webhookPost(declared)).status, 413);

  // (b) the real cap, measured on bytes read off the wire: a chunked body with NO
  // content-length must be ABORTED past the budget, not buffered and then rejected.
  // NON-VACUITY: with the unbounded `await request.text()` both of these read the whole
  // body and fall through to the signature gate, answering 400 — this asserts 413.
  assert.equal((await webhookPost(chunkedWebhook(2 * 1024 * 1024))).status, 413);

  // A normal-sized delivery is untouched by the cap (it still fails on its signature).
  assert.equal((await webhookPost(signedWebhook("evt_sized_ok", subscriptionActive, { corruptSignature: true }))).status, 400);
});

// ---- the delivery RATE is bounded too ---------------------------------------------
//
// The 256 KB cap above bounds ONE request; WEBHOOK_RATE_LIMIT bounds how many of them
// an anonymous caller may push through an HMAC verify and a SQLite transaction. The
// limiter landed with no test at all, so nothing pinned that it precedes the body read
// or that a full bucket answers the CODED 429 the client can localize.

test("webhook: a spent bucket is refused 429 with a code — and the bucket is PER CLIENT under KP_TRUSTED_PROXY", async () => {
  configurePolarEnv();
  // With KP_TRUSTED_PROXY unset every caller collapses into one shared bucket
  // (clientIpFrom's documented trap), which would make this test throttle the rest of
  // the file. Declaring one trusted hop is also the deployment shape the assertion is
  // about: a real per-client ceiling rather than a global one.
  process.env.KP_TRUSTED_PROXY = "1";
  try {
    const flooder = "203.0.113.77";
    // Spend the flooder's window through the SAME key the route builds. 600 calls into
    // the pure limiter, not 600 HTTP round-trips: the ceiling is what is being pinned,
    // not the cost of reaching it.
    for (let i = 0; i < 600; i += 1) {
      assert.equal(rateLimit(`billing-webhook:${flooder}`, { limit: 600, windowMs: 10 * 60_000 }), true, `hit ${i} must be allowed`);
    }
    // The 601st delivery is refused. Signature deliberately CORRUPT: the point is that
    // the limiter answers BEFORE the body is read and verified, so a request that would
    // otherwise be a 400 comes back 429.
    const refused = await webhookPost(signedWebhook("evt_flood", subscriptionActive, { clientIp: flooder, corruptSignature: true }));
    assert.equal(refused.status, 429);
    // A code, not English prose — a throttled Polar retry is machine-read, and the
    // client resolves `errors.TOO_MANY_REQUESTS` in the reader's language.
    assert.equal(((await refused.json()) as { code: string }).code, "TOO_MANY_REQUESTS");

    // A DIFFERENT client is untouched: one caller filling their bucket must not lock
    // every other customer's money events out of the door.
    const other = await webhookPost(
      signedWebhook("evt_other_client", subscriptionActive, { clientIp: "198.51.100.9", corruptSignature: true })
    );
    assert.equal(other.status, 400, "a fresh bucket falls through to the signature gate");
  } finally {
    delete process.env.KP_TRUSTED_PROXY;
  }
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
    // The REASON rides as a machine code (the reader gets it in their own language),
    // and the tier's name rides beside it as data — not smuggled inside English prose.
    const body = (await res.json()) as { code: string; plan: string };
    assert.equal(body.code, "BILLING_PLAN_CONTACT_SALES", "should point the buyer at sales, not a generic error");
    assert.equal(body.plan, "Enterprise");
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
  const { code, plan } = (await res.json()) as { code: string; plan: string };
  assert.equal(code, "BILLING_PLAN_WITHDRAWN", "a withdrawn tier must not be described as contact-sales");
  assert.equal(plan, "BYOM", "name the tier the caller actually asked for");
});

// ---- the provider hop is BOUNDED --------------------------------------------------
//
// Both money calls used to `fetch` with no signal, so a merchant of record that
// accepted the connection and then said nothing held the purchase page open for as
// long as it cared to — a spinner with no end state and no advice. The gateway now
// carries an AbortSignal.timeout (POLAR_REQUEST_TIMEOUT_MS) and raises its own
// timeout error, which these routes answer as BILLING_PROVIDER_TIMEOUT at 504: the
// one provider failure whose honest next step is "try again in a moment".

test("checkout: a provider that never answers is a coded 504, not an open-ended wait", async () => {
  configurePolarEnv();
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  const originalFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  // Shorten the CLOCK, not the code: the real signal is still built, handed to fetch
  // and converted by the gateway — a unit test just must not sit out ten seconds.
  AbortSignal.timeout = (() => realTimeout.call(AbortSignal, 20)) as typeof AbortSignal.timeout;
  let calls = 0;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  }) as typeof fetch;
  try {
    const res = await checkoutPost(
      new NextRequest("http://localhost/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "starter" }) })
    );
    assert.equal(res.status, 504);
    assert.equal(((await res.json()) as { code: string }).code, "BILLING_PROVIDER_TIMEOUT");
    // A checkout create is not idempotent: the timeout must not have been retried.
    assert.equal(calls, 1, "a timed-out checkout must never be re-attempted for the buyer");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = realTimeout;
  }
});

test("portal: a provider that never answers is the same coded 504", async () => {
  configurePolarEnv();
  upsertBillingState({ plan: "starter", status: "active", provider: "polar", providerCustomerId: "cus_timeout" });
  const originalFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (() => realTimeout.call(AbortSignal, 20)) as typeof AbortSignal.timeout;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  }) as typeof fetch;
  try {
    const res = await portalPost(new NextRequest("http://localhost/api/billing/portal", { method: "POST" }));
    assert.equal(res.status, 504);
    assert.equal(((await res.json()) as { code: string }).code, "BILLING_PROVIDER_TIMEOUT");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = realTimeout;
  }
});
