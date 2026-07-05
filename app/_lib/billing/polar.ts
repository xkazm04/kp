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
// end-to-end flow against the SANDBOX before going live (docs/BILLING.md has
// the checklist) — mapPolarEvent reads defensively on purpose.

import { BillingConfigError } from "./gateway";
import type { BillingEvent, BillingGateway, Checkout, CheckoutRequest, ProductMap } from "./gateway";
import { PACKS } from "./plans";
import { verifyStandardWebhook } from "./webhook-verify";

const SERVERS = {
  production: "https://api.polar.sh",
  sandbox: "https://sandbox-api.polar.sh",
} as const;

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
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  return {
    id: eventId,
    type,
    kind,
    productId: str(data.product_id) ?? str(product.id),
    status: str(data.status),
    customerId: str(data.customer_id) ?? str(customer.id),
    subscriptionId: kind === "subscription" ? str(data.id) : str(data.subscription_id),
    orderId: kind === "order" ? str(data.id) : null,
    periodStart: str(data.current_period_start),
    periodEnd: str(data.current_period_end),
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

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${SERVERS[this.cfg.server]}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Polar ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
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

  async createCheckout(req: CheckoutRequest, opts: { successUrl: string }): Promise<Checkout> {
    const data = await this.post("/v1/checkouts/", {
      products: [this.productFor(req)],
      success_url: opts.successUrl,
      metadata: req.kind === "plan" ? { kpPlan: req.plan } : { kpPack: req.pack },
    });
    const url = typeof data.url === "string" ? data.url : null;
    if (!url) throw new Error("Polar checkout response carried no url.");
    return { url, providerCheckoutId: typeof data.id === "string" ? data.id : null };
  }

  async createPortalSession(customerId: string): Promise<{ url: string }> {
    const data = await this.post("/v1/customer-sessions/", { customer_id: customerId });
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
  const cfg = polarConfigFromEnv(env);
  return cfg ? new PolarGateway(cfg) : null;
}
