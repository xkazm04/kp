// Polar (polar.sh) gateway — the only file that knows Polar's wire shapes.
// Talks the documented REST API directly (no vendor SDK: the hedge layer stays
// dependency-free and fully under our control; swapping in @polar-sh/sdk later
// is a local change to this file). Auth: an Organization Access Token.
//
// Env (see .env.example): POLAR_ACCESS_TOKEN, POLAR_SERVER (sandbox|production),
// POLAR_WEBHOOK_SECRET, and product ids created in the Polar dashboard/API:
// POLAR_PRODUCT_STARTER / _GROWTH / _BYOM / _MINUTE_PACK.
//
// NOTE: field mapping below follows Polar's documented payloads; validate the
// end-to-end flow against the SANDBOX before going live (docs/features/billing/README.md has
// the checklist) — mapPolarEvent reads defensively on purpose.

import { BillingConfigError } from "./gateway";
import type { BillingEvent, BillingGateway, Checkout, CheckoutRequest, ProductMap } from "./gateway";
import { PACKS } from "./plans";
import { verifyStandardWebhook } from "./webhook-verify";
import { isOffline } from "../offline";

const SERVERS = {
  production: "https://api.polar.sh",
  sandbox: "https://sandbox-api.polar.sh",
} as const;

/** Wall-clock budget for ONE provider call — the round trip AND the body read.
 *  A checkout or portal click is a person waiting on a button, so the bound is a
 *  human-patience number rather than a network one: past ten seconds the honest
 *  answer is "the provider did not respond, try again", not a spinner held open
 *  for as long as Polar cares to take. Before this existed, `fetch` had no budget
 *  at all and a stalled MoR held the purchase page open indefinitely. */
export const POLAR_REQUEST_TIMEOUT_MS = 10_000;

/** The provider ran out of time — distinct from BillingConfigError (our setup is
 *  wrong) and from a thrown provider error (the provider answered, with a no).
 *  The routes turn this into BILLING_PROVIDER_TIMEOUT at 504, which is the one
 *  failure whose honest advice is "try again in a moment". */
export class BillingProviderTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingProviderTimeoutError";
  }
}

/** An abort raised by our own `AbortSignal.timeout` (`TimeoutError`) or by the
 *  platform tearing the request down (`AbortError`). Matched by name because undici
 *  and Node disagree on the constructor and neither exports it. */
function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Worth exactly one more try: the provider throttled us or had a bad moment.
 *  A 4xx other than 429 is OUR request being wrong and will fail identically. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export type PolarConfig = {
  accessToken: string;
  server: keyof typeof SERVERS;
  webhookSecret: string | null;
  /** The dated API contract to pin (`Polar-Version`), or null to inherit Polar's
   *  Current — which ROTATES at each quarterly release, so an unset value is the
   *  absence of a choice rather than a stable one. Null keeps the wire bytes
   *  byte-identical to the unpinned client, so setting this env is the only thing
   *  that changes a live deployment's contract. */
  apiVersion: string | null;
  products: {
    starter: string | null;
    growth: string | null;
    byom: string | null;
    minutePack: string | null;
  };
};

export function polarConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PolarConfig | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return {
    accessToken,
    server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    webhookSecret: env.POLAR_WEBHOOK_SECRET?.trim() || null,
    apiVersion: env.POLAR_API_VERSION?.trim() || null,
    products: {
      starter: env.POLAR_PRODUCT_STARTER?.trim() || null,
      growth: env.POLAR_PRODUCT_GROWTH?.trim() || null,
      byom: env.POLAR_PRODUCT_BYOM?.trim() || null,
      minutePack: env.POLAR_PRODUCT_MINUTE_PACK?.trim() || null,
    },
  };
}

/** Normalize one Polar webhook payload (exported pure for tests).
 *
 *  `declaredVersion` is the contract the DELIVERY names (the `webhook-api-version`
 *  header); the body's own `api_version` is the fallback. It matters because a
 *  webhook endpoint's version is chosen when the endpoint is REGISTERED and an
 *  event keeps the version it was created under — so after a rotation this
 *  normalizer receives new events on the new contract and redeliveries of old ones
 *  on the old, concurrently, for the same event type. Recording it is what makes
 *  that decidable instead of a silent misparse. */
export function mapPolarEvent(
  eventId: string,
  payload: unknown,
  declaredVersion?: string | null
): BillingEvent {
  const body = (payload ?? {}) as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type : "unknown";
  const data = (body.data ?? {}) as Record<string, unknown>;
  const kind = type.startsWith("subscription.") ? "subscription" : type.startsWith("order.") ? "order" : "other";

  const product = (data.product ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  // Checkout metadata round-trip: Polar copies a checkout's metadata onto the
  // resulting subscription AND order objects, so the `kpOrgId` our createCheckout
  // stamps comes back here and attributes the money event to the buying org.
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  // Ordered units, defensively parsed: a finite positive integer, else 1. Polar
  // may send quantity as a number or a numeric string; anything else (missing on
  // a subscription event, malformed) falls back to a single unit so the grant is
  // never under- OR over-counted. bug-ui-scan-2026-07-09 (billing-engine-webhooks #4)
  const posInt = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  };

  return {
    id: eventId,
    type,
    kind,
    productId: str(data.product_id) ?? str(product.id),
    status: str(data.status),
    customerId: str(data.customer_id) ?? str(customer.id),
    subscriptionId: kind === "subscription" ? str(data.id) : str(data.subscription_id),
    orderId: kind === "order" ? str(data.id) : null,
    quantity: posInt(data.quantity),
    periodStart: str(data.current_period_start),
    periodEnd: str(data.current_period_end),
    orgId: str(metadata.kpOrgId),
    // Contract provenance: the header the delivery carried, else the version the
    // raw payload names itself. Null on a hand-built event and on a provider that
    // publishes no versions — absence is recorded as absence, never as "current".
    apiVersion: str(declaredVersion) ?? str(body.api_version),
    raw: payload,
  };
}

/** The contract version the provider says it actually used, last seen on a response
 *  or a delivery. A deployment that has never pinned one is running on whatever
 *  Current is today; this is how it finds out WHICH, which is the prerequisite for
 *  pinning at all. Read by the billing doctor / reconcile logging — never by a
 *  decision, because a value we merely observed must not steer behaviour. */
let lastObservedApiVersion: string | null = null;

export function observedPolarApiVersion(): string | null {
  return lastObservedApiVersion;
}

/** Record and log a contract version the provider declared. Logs only on CHANGE, so
 *  a steady deployment is silent and a rotation is one line in the log on the day it
 *  happens — which is the event an unpinned integration currently has no signal for. */
export function noteObservedApiVersion(version: string | null | undefined): void {
  const v = typeof version === "string" && version.trim() ? version.trim() : null;
  if (!v || v === lastObservedApiVersion) return;
  const previous = lastObservedApiVersion;
  lastObservedApiVersion = v;
  console.warn(
    previous
      ? `[billing:polar] provider API contract version changed ${previous} -> ${v}`
      : `[billing:polar] provider API contract version observed: ${v}`
  );
}

export class PolarGateway implements BillingGateway {
  readonly provider = "polar";
  // Explicit field, not a constructor parameter property — Node's strip-only
  // TS mode (npm run test:unit) can't strip parameter properties.
  private readonly cfg: PolarConfig;

  constructor(cfg: PolarConfig) {
    this.cfg = cfg;
  }

  /** Every outbound header in one place. `Polar-Version` is present ONLY when the
   *  deployment pinned one: omitting it reproduces the previous wire bytes exactly,
   *  so adopting this file cannot move a running integration's contract by itself.
   *  Pinning is a deliberate env change, made once the observed version is known. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.accessToken}`,
      ...(this.cfg.apiVersion ? { "Polar-Version": this.cfg.apiVersion } : {}),
      ...extra,
    };
  }

  productMap(): ProductMap {
    const map: ProductMap = {};
    if (this.cfg.products.starter) map[this.cfg.products.starter] = { kind: "plan", plan: "starter" };
    if (this.cfg.products.growth) map[this.cfg.products.growth] = { kind: "plan", plan: "growth" };
    if (this.cfg.products.byom) map[this.cfg.products.byom] = { kind: "plan", plan: "byom" };
    if (this.cfg.products.minutePack) {
      const pack = PACKS.minutes_100;
      map[this.cfg.products.minutePack] = { kind: "pack", meter: pack.meter, qty: pack.qty };
    }
    return map;
  }

  /** ONE attempt at a POST, bounded end-to-end (connect, response AND body read) by
   *  POLAR_REQUEST_TIMEOUT_MS. Returns the parsed body on 2xx and the failing
   *  status+text otherwise, so `post` below can decide whether that status is worth
   *  a second try; an abort is raised as BillingProviderTimeoutError because a
   *  timeout is a different answer to the caller than "the provider said no". */
  private async attempt(
    path: string,
    body: unknown
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; text: string }> {
    try {
      const res = await fetch(`${SERVERS[this.cfg.server]}${path}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        // The signal covers `res.text()` as well as the round trip, so a provider
        // that answers headers and then stalls the body is bounded too.
        signal: AbortSignal.timeout(POLAR_REQUEST_TIMEOUT_MS),
      });
      // The contract the provider says it USED, not the one we asked for. On an
      // unpinned deployment these are the only bytes that name the live contract.
      noteObservedApiVersion(res.headers.get("polar-version"));
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text };
      return { ok: true, data: JSON.parse(text) as Record<string, unknown> };
    } catch (error) {
      if (isAbortLike(error)) {
        throw new BillingProviderTimeoutError(
          `Polar ${path} did not answer within ${POLAR_REQUEST_TIMEOUT_MS}ms.`
        );
      }
      throw error;
    }
  }

  /** `retryTransient` is opt-in PER CALL SITE and never a default: whether a second
   *  attempt is safe is a property of the endpoint, not of the failure. See the two
   *  call sites below for which one gets it and why. */
  private async post(
    path: string,
    body: unknown,
    opts: { retryTransient?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const first = await this.attempt(path, body);
    if (first.ok) return first.data;
    if (opts.retryTransient && isTransientStatus(first.status)) {
      const second = await this.attempt(path, body);
      if (second.ok) return second.data;
      throw new Error(`Polar ${path} failed (${second.status}): ${second.text.slice(0, 300)}`);
    }
    throw new Error(`Polar ${path} failed (${first.status}): ${first.text.slice(0, 300)}`);
  }

  /** Read ONE product object (its `prices` are what the customer is actually charged)
   *  for the clock's daily price reconcile. */
  fetchProduct(productId: string): Promise<unknown | null> {
    return this.read("product", "/v1/products/", productId);
  }

  /** Read ONE subscription object for the daily subscription reconcile
   *  (subscription-reconcile.ts) — the object a webhook delivery carries as `data`. */
  fetchSubscription(subscriptionId: string): Promise<unknown | null> {
    return this.read("subscription", "/v1/subscriptions/", subscriptionId);
  }

  /** The one background GET. Bounded by the same budget as the POSTs and never
   *  retried: its callers are daily clock passes, which would rather skip an object
   *  for a day than double an already-throttled provider's load. Null on ANY failure
   *  (an unreadable object is "unknown", which the pure decisions treat as no verdict,
   *  never as drift), and refused outright under KP_OFFLINE, whoever built the gateway. */
  private async read(what: string, path: string, id: string): Promise<unknown | null> {
    if (isOffline()) return null;
    try {
      const res = await fetch(`${SERVERS[this.cfg.server]}${path}${encodeURIComponent(id)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(POLAR_REQUEST_TIMEOUT_MS),
      });
      noteObservedApiVersion(res.headers.get("polar-version"));
      if (!res.ok) return null;
      return JSON.parse(await res.text()) as unknown;
    } catch (error) {
      // Best-effort by contract: this read informs a background alert, never a
      // request. Logged so a persistently unreadable object is still visible.
      console.warn(`[billing:reconcile] could not read Polar ${what} ${id}:`, error);
      return null;
    }
  }

  /** The product ids this deployment configured — the reconcile's input. */
  configuredProducts(): PolarConfig["products"] {
    return this.cfg.products;
  }

  private productFor(req: CheckoutRequest): string {
    const id =
      req.kind === "plan"
        ? // `enterprise` is contact-sales and has no self-serve product — the checkout
          // route rejects it before we get here, so this maps to null (the guard below
          // then throws the standard "no product configured" error, never hit at runtime).
          { starter: this.cfg.products.starter, growth: this.cfg.products.growth, byom: this.cfg.products.byom, enterprise: null }[
            req.plan
          ]
        : this.cfg.products.minutePack;
    if (!id) {
      const envName = req.kind === "plan" ? `POLAR_PRODUCT_${req.plan.toUpperCase()}` : "POLAR_PRODUCT_MINUTE_PACK";
      throw new Error(`No Polar product configured for this purchase — set ${envName} in .env.`);
    }
    return id;
  }

  async createCheckout(
    req: CheckoutRequest,
    opts: { successUrl: string; orgId?: string | null; customerId?: string | null }
  ): Promise<Checkout> {
    // NEVER RETRIED, deliberately: creating a checkout is not idempotent (Polar has
    // no idempotency key on this endpoint), so a second attempt after a timeout or a
    // 5xx can mint a SECOND live session for the same intent — two payable links for
    // one purchase. The buyer clicking "Buy" again is the safe retry, because it is a
    // decision rather than a guess about whether the first one landed.
    //
    // `customer_id` is opt-in and omitted when empty so a first-purchase body stays
    // byte-identical on that key (polar-contract-version inertness). When set, Polar
    // attaches the session to that customer. A 404/invalid id MUST surface as the
    // thrown post() error — dropping the id and retrying would silently mint a
    // second MoR customer, which is the failure this field exists to prevent.
    const customerId = opts.customerId?.trim() || null;
    const data = await this.post("/v1/checkouts/", {
      products: [this.productFor(req)],
      success_url: opts.successUrl,
      metadata: {
        ...(req.kind === "plan" ? { kpPlan: req.plan } : { kpPack: req.pack }),
        // Org attribution (org-plan Phase 3): Polar copies checkout metadata onto
        // the subscription/order, and mapPolarEvent reads it back as event.orgId.
        ...(opts.orgId ? { kpOrgId: opts.orgId } : {}),
      },
      ...(customerId ? { customer_id: customerId } : {}),
    });
    const url = typeof data.url === "string" ? data.url : null;
    if (!url) throw new Error("Polar checkout response carried no url.");
    return { url, providerCheckoutId: typeof data.id === "string" ? data.id : null };
  }

  async createPortalSession(customerId: string): Promise<{ url: string }> {
    // RETRIED ONCE on a transient status. A customer-session is a read-shaped mint:
    // it creates a short-lived token for an EXISTING customer, charges nothing and
    // supersedes nothing, so a second attempt after a 429/5xx costs one extra session
    // token and saves the owner a dead "Manage subscription" button.
    const data = await this.post("/v1/customer-sessions/", { customer_id: customerId }, { retryTransient: true });
    const url =
      (typeof data.customer_portal_url === "string" && data.customer_portal_url) ||
      (typeof data.url === "string" && data.url) ||
      null;
    if (!url) throw new Error("Polar customer-session response carried no portal url.");
    return { url };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | null>): BillingEvent {
    if (!this.cfg.webhookSecret) {
      throw new BillingConfigError(
        "POLAR_WEBHOOK_SECRET is not set — refusing to process an unverifiable webhook."
      );
    }
    const id = headers["webhook-id"];
    verifyStandardWebhook(
      rawBody,
      { id, timestamp: headers["webhook-timestamp"], signature: headers["webhook-signature"] },
      this.cfg.webhookSecret
    );
    const declaredVersion = headers["webhook-api-version"];
    noteObservedApiVersion(declaredVersion);
    return mapPolarEvent(id as string, JSON.parse(rawBody), declaredVersion);
  }
}

export function polarGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): PolarGateway | null {
  // Hard no-egress mode (E-SH-4): Polar is a cloud Merchant-of-Record, so billing is
  // disabled under KP_OFFLINE — the routes report unconfigured (503 / "not
  // configured") instead of erroring against the fetch guard. Defense in depth: the
  // offline fetch guard would already block api.polar.sh, but returning null here
  // keeps the Billing UX honest rather than surfacing a blocked-fetch error.
  if (isOffline(env)) return null;
  const cfg = polarConfigFromEnv(env);
  return cfg ? new PolarGateway(cfg) : null;
}
