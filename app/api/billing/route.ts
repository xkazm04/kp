import { NextResponse } from "next/server";
import { billingOverview, PACKS, PLANS, polarGatewayFromEnv } from "@/app/_lib/billing";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireBillingAuthority } from "./authority";


// Billing overview (docs/features/billing/README.md): the entitled plan, per-meter allowance
// state (included limit, month's usage, prepaid credits, remaining), and the
// catalogs the pricing UI renders. `configured` tells the UI whether checkout
// is wired (Polar env present) or the workspace is running unbilled local-dev.

export async function GET() {
  // `org:manage` — the same authority the two spending doors need (authority.ts).
  // This response carries the org's commercial position: which plan it pays for,
  // how much of each metered allowance it has burned, and how many prepaid credits
  // remain. That is owner information, not team-wide reading.
  const denied = await requireBillingAuthority();
  if (denied) return denied;
  try {
    // Org scope (org-plan Phase 3): the overview reads the CALLER's org via their
    // session workspace (billingOverview → billingOrgForWorkspace). Single-tenant
    // sessions resolve to the default org — the exact rows this always read.
    const workspace = await currentWorkspace();
    return NextResponse.json({
      ...billingOverview(new Date(), workspace),
      configured: polarGatewayFromEnv() !== null,
      catalog: { plans: PLANS, packs: PACKS },
    });
  } catch (error) {
    // billingOverview runs several synchronous SQLite reads; a locked/transient DB
    // would otherwise return an unframed 500 (leaking internals) and the Billing tab
    // shows a dead-end. Log server-side, answer the stable code the tab localizes.
    return safeJsonError(error, "api/billing", "BILLING_OVERVIEW_FAILED");
  }
}
