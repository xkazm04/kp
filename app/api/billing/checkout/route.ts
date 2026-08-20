import { NextRequest, NextResponse } from "next/server";
import {
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
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Start a checkout: body { plan: "starter"|"growth" } XOR { pack: "minutes_100" }.
// Returns the provider-hosted checkout URL — the client redirects; entitlement lands
// later via the webhook (never from the client). Plans that are not SELF-SERVE are
// rejected here so a crafted body can't buy one: Enterprise is contact-sales (no fixed
// price/product) and BYOM is legacy (withdrawn from sale, still honored for whoever
// holds it). isSelfServePlan (plans.ts) is the single encoding of that rule.

export async function POST(request: NextRequest) {
  // Defense in depth (matches proxy.ts; no-op in open dev mode): only an operator
  // starts a checkout, so an unauth caller can't spin up checkout sessions at will.
  const denied = await requireOperator();
  if (denied) return denied;
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json(
      { error: "Billing is not configured (set POLAR_ACCESS_TOKEN — see docs/features/billing/README.md)." },
      { status: 503 }
    );
  }

  // Org scope (org-plan Phase 3): the buying org — resolved from the caller's
  // session workspace. Stamped into the checkout metadata so the webhook events
  // attribute back to it, and used for the already-subscribed guard below.
  const orgId = billingOrgForWorkspace(await currentWorkspace());

  const body = (await request.json().catch(() => null)) as { plan?: unknown; pack?: unknown } | null;
  // A non-self-serve tier is a valid plan id but is never bought here — fail it with a
  // clear message rather than letting it fall through to the gateway (which would 502
  // on the missing/withdrawn product) or the generic 400 below. There are TWO distinct
  // reasons a plan isn't self-serve (plans.ts) and the caller needs the right one:
  // `contactSales` (Enterprise — custom-priced, talk to us) and `legacy` (BYOM —
  // WITHDRAWN from sale, nothing to talk about). One shared message told a would-be
  // BYOM buyer that Enterprise is contact-sales, which is simply not their situation.
  if (body && isPlanId(body.plan) && body.plan !== "free" && !isSelfServePlan(body.plan)) {
    const plan = PLANS[body.plan];
    return NextResponse.json(
      {
        error: plan.contactSales
          ? `${plan.name} is a custom, contact-sales plan — talk to our team to get set up.`
          : `${plan.name} is no longer sold. Pick one of the current plans, or self-host KP for free (AGPL-3.0) to keep running on your own model keys.`,
      },
      { status: 400 }
    );
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
      return NextResponse.json(
        { error: "You already have a plan — change it from the customer portal in Billing (Manage subscription), not a new checkout." },
        { status: 403 }
      );
    }
    req = { kind: "plan", plan: body.plan };
  } else if (body && isPackId(body.pack)) {
    req = { kind: "pack", pack: body.pack };
  } else {
    return NextResponse.json(
      { error: "Body must carry { plan: starter|growth } or { pack: minutes_100 }." },
      { status: 400 }
    );
  }

  try {
    // Land back ON the Billing tab so the recruiter sees their plan; the
    // `billing=success` flag tells BillingTab to confirm + poll for the settled
    // entitlement (the webhook lands the plan a moment later).
    const successUrl = `${publicBaseUrl(new URL(request.url).origin)}/?tab=billing&billing=success`;
    const checkout = await gateway.createCheckout(req, { successUrl, orgId });
    return NextResponse.json(checkout);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout creation failed." },
      { status: 502 }
    );
  }
}
