import { NextResponse } from "next/server";
import { billingOrgForWorkspace, billingOverview, PACKS, PLANS, polarGatewayFromEnv } from "@/app/_lib/billing";
import { billingAlertViews, DEPLOYMENT_ALERT_KINDS } from "@/app/_lib/billing/alerts";
import { listBillingAlertsForOrg, type BillingAlert } from "@/app/_lib/db/billing";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { HOME_ORG_ID, isHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { requireBillingAuthority } from "./authority";


// Billing overview (docs/features/billing/README.md): the entitled plan, per-meter allowance
// state (included limit, month's usage, prepaid credits, remaining), and the
// catalogs the pricing UI renders. `configured` tells the UI whether checkout
// is wired (Polar env present) or the workspace is running unbilled local-dev.
// `alerts` is the org's open billing alerts (app/_lib/billing/alerts.ts): coded, with
// the provider detail and the deployment-level kinds for the home-org operator only.

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
    const homeOrgReader = await isHomeOrgReader();
    return NextResponse.json({
      ...billingOverview(new Date(), workspace),
      configured: polarGatewayFromEnv() !== null,
      catalog: { plans: PLANS, packs: PACKS },
      alerts: billingAlertViews(openAlertsFor(billingOrgForWorkspace(workspace), homeOrgReader), { homeOrgReader }),
    });
  } catch (error) {
    // billingOverview runs several synchronous SQLite reads; a locked/transient DB
    // would otherwise return an unframed 500 (leaking internals) and the Billing tab
    // shows a dead-end. Log server-side, answer the stable code the tab localizes.
    return safeJsonError(error, "api/billing", "BILLING_OVERVIEW_FAILED");
  }
}

/** The caller's org's open alerts, plus — for the home-org operator only — the
 *  deployment-level kinds (price drift), which are recorded under the home org. A
 *  reader outside the home org never reads a row that is not their own org's. */
function openAlertsFor(orgId: string, homeOrgReader: boolean): BillingAlert[] {
  const own = listBillingAlertsForOrg(orgId);
  if (!homeOrgReader || orgId === HOME_ORG_ID) return own;
  const deployment = listBillingAlertsForOrg(HOME_ORG_ID).filter((a) => (DEPLOYMENT_ALERT_KINDS as readonly string[]).includes(a.kind));
  return [...own, ...deployment].sort((a, b) => b.id - a.id);
}
