import { NextResponse } from "next/server";
import { billingOverview, PACKS, PLANS, polarGatewayFromEnv } from "@/app/_lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Billing overview (docs/BILLING.md): the entitled plan, per-meter allowance
// state (included limit, month's usage, prepaid credits, remaining), and the
// catalogs the pricing UI renders. `configured` tells the UI whether checkout
// is wired (Polar env present) or the workspace is running unbilled local-dev.

export async function GET() {
  return NextResponse.json({
    ...billingOverview(),
    configured: polarGatewayFromEnv() !== null,
    catalog: { plans: PLANS, packs: PACKS },
  });
}
