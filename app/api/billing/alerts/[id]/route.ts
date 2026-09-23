import { NextResponse } from "next/server";
import { billingOrgForWorkspace } from "@/app/_lib/billing";
import { DEPLOYMENT_ALERT_KINDS, isBillingAlertResolution } from "@/app/_lib/billing/alerts";
import { getBillingAlert, resolveBillingAlert, type BillingAlert } from "@/app/_lib/db/billing";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { HOME_ORG_ID, isHomeOrgReader } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// POST /api/billing/alerts/[id] — close one billing alert, saying HOW it ended
// (docs/features/billing/README.md → "Billing alerts").
//
// Body: { resolution: "fixed" | "dismissed" }. Writes ONLY billing_alerts — no money
// table, no entitlement: resolving a paid-but-dark subscription's alert does not grant
// its plan (the webhook does that, once the product is mapped). Pinned by the
// charge-parity guard in billing-alerts-route.test.ts.
//
// AUTHORITY: `org:manage`, the billing door every other billing route uses (authority.ts). TENANT: an
// alert of another org answers exactly what an unknown id answers (404, no existence
// oracle); a deployment-level kind (price drift, stored under the home org) is
// reachable only by the home-org operator. CAS: the store's compensating WHERE
// (`resolved_at IS NULL`) makes a second call a 409, never a re-kind.

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // The billing door, `org:manage` — requireBillingAuthority (authority.ts) spelled out,
  // so this write asks its capability in its own source (route-capability-coverage).
  const denied = await requireOrgCapability("org:manage");
  if (denied) return denied.status === 401 ? denied : jsonRefusal("BILLING_ORG_MANAGE_REQUIRED", 403);
  const { id: raw } = await context.params;
  const id = /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null;
  if (id === null) return jsonRefusal("BILLING_ALERT_NOT_FOUND", 404);

  const body = (await request.json().catch(() => null)) as { resolution?: unknown } | null;
  const resolution = body?.resolution;
  if (!isBillingAlertResolution(resolution)) return jsonRefusal("BILLING_ALERT_RESOLUTION_INVALID", 400);

  try {
    const orgId = billingOrgForWorkspace(await currentWorkspace());
    const alert = await findAlert(id, orgId);
    if (!alert) return jsonRefusal("BILLING_ALERT_NOT_FOUND", 404);
    if (alert.resolvedAt !== null) return jsonRefusal("BILLING_ALERT_NOT_OPEN", 409);
    // The read above is advisory; the UPDATE's own `resolved_at IS NULL` is the guard.
    if (!resolveBillingAlert({ id, orgId: alert.orgId, resolution })) return jsonRefusal("BILLING_ALERT_NOT_OPEN", 409);
    return NextResponse.json({ id, resolution });
  } catch (error) {
    return safeJsonError(error, "api/billing/alerts/[id]", "BILLING_ALERT_RESOLVE_FAILED");
  }
}

/** The caller's own org's alert, or — for the home-org operator only — a
 *  deployment-level alert recorded under the home org. */
async function findAlert(id: number, orgId: string): Promise<BillingAlert | null> {
  const own = getBillingAlert(id, orgId);
  if (own) return own;
  if (orgId === HOME_ORG_ID || !(await isHomeOrgReader())) return null;
  const home = getBillingAlert(id, HOME_ORG_ID);
  return home && (DEPLOYMENT_ALERT_KINDS as readonly string[]).includes(home.kind) ? home : null;
}
