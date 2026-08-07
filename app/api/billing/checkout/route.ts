import { NextRequest, NextResponse } from "next/server";
import {
  billingOrgForWorkspace,
  hasActiveSubscription,
  isPackId,
  isPlanId,
  isSelfServePlan,
  polarGatewayFromEnv,
  type CheckoutRequest,
} from "@/app/_lib/billing";
import { getBillingState } from "@/app/_lib/db/billing";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Start a checkout: body { plan: "starter"|"growth"|"byom" } XOR { pack:
// "minutes_100" }. Returns the provider-hosted checkout URL — the client
// redirects; entitlement lands later via the webhook (never from the client).
// The Enterprise tier is contact-sales (custom-priced): it is rejected here so a
// crafted body can't try to self-serve a plan that has no fixed price/product.

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
  // A contact-sales tier (Enterprise) is a valid plan id but is never self-served —
  // fail it with a clear, distinct message rather than letting it fall through to
  // the gateway (which would 502 on the missing product) or the generic 400 below.
  if (body && isPlanId(body.plan) && body.plan !== "free" && !isSelfServePlan(body.plan)) {
    return NextResponse.json(
      { error: "Enterprise is a custom, contact-sales plan — talk to our team to get set up." },
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
    if (hasActiveSubscription(getBillingState(orgId))) {
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
      { error: "Body must carry { plan: starter|growth|byom } or { pack: minutes_100 }." },
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
