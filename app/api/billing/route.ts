import { NextResponse } from "next/server";
import { billingOverview, PACKS, PLANS, polarGatewayFromEnv } from "@/app/_lib/billing";


// Billing overview (docs/features/billing/README.md): the entitled plan, per-meter allowance
// state (included limit, month's usage, prepaid credits, remaining), and the
// catalogs the pricing UI renders. `configured` tells the UI whether checkout
// is wired (Polar env present) or the workspace is running unbilled local-dev.

export async function GET() {
  try {
    return NextResponse.json({
      ...billingOverview(),
      configured: polarGatewayFromEnv() !== null,
      catalog: { plans: PLANS, packs: PACKS },
    });
  } catch (error) {
    // billingOverview runs several synchronous SQLite reads; a locked/transient DB
    // would otherwise return an unframed 500 (leaking internals) and the Billing tab
    // shows a dead-end. Mirror the analyses route: log server-side, return a stable
    // framed error.
    console.error("[api/billing] overview failed", error);
    return NextResponse.json({ error: "Failed to load billing." }, { status: 500 });
  }
}
