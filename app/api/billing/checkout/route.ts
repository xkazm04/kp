import { NextRequest } from "next/server";
import {
  BillingProviderTimeoutError,
  billingOrgForWorkspace,
  entitledPlan,
  hasActiveSubscription,
  isPackId,
  isPlanId,
  isSelfServePlan,
  PLANS,
  polarGatewayFromEnv,
  type CheckoutRequest,
} from "@/app/_lib/billing";
import { getBillingState } from "@/app/_lib/db/billing";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { requireBillingAuthority } from "../authority";


// Start a checkout: body { plan: "starter"|"growth" } XOR { pack: "minutes_100" }.
// Returns the provider-hosted checkout URL — the client redirects; entitlement lands
// later via the webhook (never from the client). Plans that are not SELF-SERVE are
// rejected here so a crafted body can't buy one: Enterprise is contact-sales (no fixed
// price/product) and BYOM is legacy (withdrawn from sale, still honored for whoever
// holds it). isSelfServePlan (plans.ts) is the single encoding of that rule.

// The spend door's throttle. Every accepted call mints a real, live checkout session
// at the merchant of record; the authority gate above is a documented NO-OP in open
// mode (KP_OPERATOR_PASSWORD unset makes the whole API open), so this limiter is the
// only bound on an unauthenticated caller looping checkout sessions. 10/10min per IP
// is far above any human buying pace — a person buys once, or retries a card twice.
const CHECKOUT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  // Billing is `org:manage` (authority.ts): an owner decision, not a recruiter's.
  const denied = await requireBillingAuthority();
  if (denied) return denied;
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return jsonRefusal("BILLING_NOT_CONFIGURED", 503);
  }

  // Org scope (org-plan Phase 3): the buying org — resolved from the caller's
  // session workspace. Stamped into the checkout metadata so the webhook events
  // attribute back to it, and used for the already-subscribed guard below.
  const orgId = billingOrgForWorkspace(await currentWorkspace());

  const body = (await request.json().catch(() => null)) as { plan?: unknown; pack?: unknown } | null;
  // A non-self-serve tier is a valid plan id but is never bought here — fail it with a
  // clear reason rather than letting it fall through to the gateway (which would 502
  // on the missing/withdrawn product) or the generic 400 below. There are TWO distinct
  // reasons a plan isn't self-serve (plans.ts) and the caller needs the right one:
  // `contactSales` (Enterprise — custom-priced, talk to us) and `legacy` (BYOM —
  // WITHDRAWN from sale, nothing to talk about). One shared message told a would-be
  // BYOM buyer that Enterprise is contact-sales, which is simply not their situation.
  // The tier's NAME rides beside the code as data, so an API consumer keeps it while
  // the reader gets the sentence in their own language.
  if (body && isPlanId(body.plan) && body.plan !== "free" && !isSelfServePlan(body.plan)) {
    const plan = PLANS[body.plan];
    return jsonRefusal(plan.contactSales ? "BILLING_PLAN_CONTACT_SALES" : "BILLING_PLAN_WITHDRAWN", 400, {
      plan: plan.name,
    });
  }
  let req: CheckoutRequest;
  // Any contact-sales tier already returned above, so a non-free plan here is
  // self-serve. `!== "free"` also narrows the type to Exclude<PlanId, "free">.
  if (body && isPlanId(body.plan) && body.plan !== "free") {
    // Server-side "already subscribed" guard — the trust boundary, not just the
    // client's `changeVia` hint. An existing subscriber must change plans through the
    // PORTAL; a stale tab (or a crafted raw POST) that reaches here with a live
    // subscription would mint a SECOND, parallel Polar subscription and double-charge.
    // (Pack top-ups are exempt: they're one-time and sold on any tier.)
    const state = getBillingState(orgId);
    // …but the guard must not outlive the subscription. `hasActiveSubscription` reads
    // the RAW stored status, while entitlement reads the same row through entitledPlan,
    // which BOUNDS `canceled` (cancel-at-period-end) by currentPeriodEnd. If the
    // terminal `revoked` is ever dropped — the same delivery gap entitledPlan already
    // defends against — the customer sits on `canceled` past their paid period: free
    // entitlement AND a 403, stranded, because the portal has nothing left to change.
    // A cancel-at-period-end is dead at the MoR once that date passes, so a fresh
    // checkout is the only way back and cannot double up on anything.
    // Deliberately NOT extended to past_due/unpaid: those bound the entitlement too,
    // but the subscription there is LIVE and in dunning — a second checkout would run
    // in parallel and double-charge. Nor to a canceled row with an unparseable period
    // end (entitledPlan keeps the plan there), which stays portal-only.
    const cancelLapsed = state?.status === "canceled" && entitledPlan(state).id === "free";
    if (hasActiveSubscription(state) && !cancelLapsed) {
      return jsonRefusal("BILLING_ALREADY_SUBSCRIBED", 403);
    }
    req = { kind: "plan", plan: body.plan };
  } else if (body && isPackId(body.pack)) {
    req = { kind: "pack", pack: body.pack };
  } else {
    return jsonRefusal("BILLING_CHECKOUT_BODY_INVALID", 400);
  }

  // AFTER every cheap refusal and BEFORE the provider hop: a body that was never
  // going to buy anything must not consume the window, and a throttled call must
  // never reach the merchant of record.
  if (!rateLimit(`billing-checkout:${clientIpFrom(request.headers)}`, CHECKOUT_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  try {
    // Land back ON the Billing tab so the recruiter sees their plan; the
    // `billing=success` flag tells BillingTab to confirm + poll for the settled
    // entitlement (the webhook lands the plan a moment later).
    const successUrl = `${publicBaseUrl(new URL(request.url).origin)}/?tab=billing&billing=success`;
    const checkout = await gateway.createCheckout(req, { successUrl, orgId });
    return jsonOk(checkout);
  } catch (error) {
    // A provider that ran out of time is a DIFFERENT answer from a provider that said
    // no: the buyer's next move is "try again in a moment", and the checkout was never
    // retried for them (createCheckout is not idempotent), so nothing is pending.
    if (error instanceof BillingProviderTimeoutError) {
      return safeJsonError(error, "api/billing/checkout", "BILLING_PROVIDER_TIMEOUT", 504);
    }
    // The gateway's thrown message is its upstream HTTP body — internal detail, and
    // in a language nobody here chose. Log it server-side, answer the stable code.
    return safeJsonError(error, "api/billing/checkout", "BILLING_CHECKOUT_FAILED", 502);
  }
}
