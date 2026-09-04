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
    products: {
      starter: env.POLAR_PRODUCT_STARTER?.trim() || null,
      growth: env.POLAR_PRODUCT_GROWTH?.trim() || null,
      byom: env.POLAR_PRODUCT_BYOM?.trim() || null,
      minutePack: env.POLAR_PRODUCT_MINUTE_PACK?.trim() || null,
    },
  };
}

/** Normalize one Polar webhook payload (exported pure for tests). */
export function mapPolarEvent(eventId: string, payload: unknown): BillingEvent {
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
    raw: payload,
  };
}

export class PolarGateway implements BillingGateway {
  readonly provider = "polar";
  // Explicit field, not a constructor parameter property — Node's strip-only
  // TS mode (npm run test:unit) can't strip parameter properties.
  private readonly cfg: PolarConfig;

  constructor(cfg: PolarConfig) {
    this.cfg = cfg;
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
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        // The signal covers `res.text()` as well as the round trip, so a provider
        // that answers headers and then stalls the body is bounded too.
        signal: AbortSignal.timeout(POLAR_REQUEST_TIMEOUT_MS),
      });
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

  async createCheckout(req: CheckoutRequest, opts: { successUrl: string; orgId?: string | null }): Promise<Checkout> {
    // NEVER RETRIED, deliberately: creating a checkout is not idempotent (Polar has
    // no idempotency key on this endpoint), so a second attempt after a timeout or a
    // 5xx can mint a SECOND live session for the same intent — two payable links for
    // one purchase. The buyer clicking "Buy" again is the safe retry, because it is a
    // decision rather than a guess about whether the first one landed.
    const data = await this.post("/v1/checkouts/", {
      products: [this.productFor(req)],
      success_url: opts.successUrl,
      metadata: {
        ...(req.kind === "plan" ? { kpPlan: req.plan } : { kpPack: req.pack }),
        // Org attribution (org-plan Phase 3): Polar copies checkout metadata onto
        // the subscription/order, and mapPolarEvent reads it back as event.orgId.
        ...(opts.orgId ? { kpOrgId: opts.orgId } : {}),
      },
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
    return mapPolarEvent(id as string, JSON.parse(rawBody));
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
