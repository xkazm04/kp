import { NextRequest } from "next/server";
import { billingOrgForWorkspace, polarGatewayFromEnv } from "@/app/_lib/billing";
import { getBillingState } from "@/app/_lib/db/billing";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BillingProviderTimeoutError } from "@/app/_lib/billing/polar";
import { requireBillingAuthority } from "../authority";


// Customer portal (manage/cancel the subscription, download MoR invoices):
// mints a provider customer-session and returns its URL. Needs a synced
// customer id, i.e. at least one completed checkout.

// This mints a LIVE merchant-of-record session — cancel the subscription, read
// invoices and billing PII. The authority gate is a documented no-op in open mode,
// so the limiter is the real bound there. 20/10min per IP: one click per visit,
// plus the odd re-open after a popup blocker ate the pre-opened tab.
const PORTAL_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  // `org:manage` (authority.ts). This URL cancels the subscription and lists
  // invoices — until now any recruiter or viewer with a session could mint one.
  const denied = await requireBillingAuthority();
  if (denied) return denied;
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return jsonRefusal("BILLING_NOT_CONFIGURED", 503);
  }
  // Org scope (org-plan Phase 3): mint the portal for the CALLER's org's customer.
  const customerId = getBillingState(billingOrgForWorkspace(await currentWorkspace()))?.providerCustomerId;
  if (!customerId) {
    // A calm, expected pre-first-purchase state, not a failure — the client renders
    // it as a hint (billingPortalOpen.ts maps this 404 to `kind: "hint"`).
    return jsonRefusal("BILLING_NO_CUSTOMER", 404);
  }
  // After the cheap refusals, before the provider hop.
  if (!rateLimit(`billing-portal:${clientIpFrom(request.headers)}`, PORTAL_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    return jsonOk(await gateway.createPortalSession(customerId));
  } catch (error) {
    // Already retried once inside the gateway on a transient status; a timeout here
    // means two full budgets elapsed, so say "the provider did not answer" rather
    // than the generic "could not open the portal".
    if (error instanceof BillingProviderTimeoutError) {
      return safeJsonError(error, "api/billing/portal", "BILLING_PROVIDER_TIMEOUT", 504);
    }
    return safeJsonError(error, "api/billing/portal", "BILLING_PORTAL_FAILED", 502);
  }
}
