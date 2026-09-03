import type { NextResponse } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";

// The billing door's gate. `org:manage` is defined in auth/roles.ts as exactly
// "billing, org profile/settings, delete org — owner only", and until now not one
// billing route asked for it: `requireOperator()` answers "is there a valid session
// on this deployment?", which every recruiter and viewer also satisfies. So any
// member could start a checkout that charges the org's card, and mint a
// merchant-of-record portal URL that cancels the subscription and lists invoices.
//
// ORG-level (`requireOrgCapability`), not workspace-level: a subscription is bought
// per ORG (billingOrgForWorkspace resolves the buying org from the caller's session
// workspace), so authority over it is org-wide too — an owner administering a second
// team must still be able to pay for it.
//
// Open dev mode (no KP_OPERATOR_PASSWORD) and an operator-password session both fold
// to owner inside callerOrgCapabilities, so a self-hosted single-operator install is
// unchanged. The per-IP limiter on the two spending doors is what bounds open mode.

/** 403 + a machine code when the caller is signed in but not an owner; the plain
 *  401 when there is no session at all (nothing to localize for — the client is not
 *  yet a reader of this org's language). Null = proceed. */
export async function requireBillingAuthority(): Promise<NextResponse | null> {
  const denied = await requireOrgCapability("org:manage");
  if (!denied) return null;
  if (denied.status === 401) return denied;
  return jsonRefusal("BILLING_ORG_MANAGE_REQUIRED", 403);
}
