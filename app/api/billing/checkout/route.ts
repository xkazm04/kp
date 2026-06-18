import { NextRequest, NextResponse } from "next/server";
import { isPackId, isPlanId, polarGatewayFromEnv, type CheckoutRequest } from "@/app/_lib/billing";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Start a checkout: body { plan: "starter"|"growth"|"byom" } XOR { pack:
// "minutes_100" }. Returns the provider-hosted checkout URL — the client
// redirects; entitlement lands later via the webhook (never from the client).

export async function POST(request: NextRequest) {
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json(
      { error: "Billing is not configured (set POLAR_ACCESS_TOKEN — see docs/BILLING.md)." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as { plan?: unknown; pack?: unknown } | null;
  let req: CheckoutRequest;
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
