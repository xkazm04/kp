import { NextRequest, NextResponse } from "next/server";
import { isPackId, isPlanId, isSelfServePlan, polarGatewayFromEnv, type CheckoutRequest } from "@/app/_lib/billing";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { requireOperator } from "@/app/_lib/auth/require-operator";


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
      { error: "Billing is not configured (set POLAR_ACCESS_TOKEN — see docs/BILLING.md)." },
      { status: 503 }
    );
  }

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
    const checkout = await gateway.createCheckout(req, { successUrl });
    return NextResponse.json(checkout);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout creation failed." },
      { status: 502 }
    );
  }
}
