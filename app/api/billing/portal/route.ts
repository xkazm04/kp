import { NextResponse } from "next/server";
import { polarGatewayFromEnv } from "@/app/_lib/billing";
import { getBillingState } from "@/app/_lib/db";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// Customer portal (manage/cancel the subscription, download MoR invoices):
// mints a provider customer-session and returns its URL. Needs a synced
// customer id, i.e. at least one completed checkout.

export async function POST() {
  // Defense in depth: this mints a live MoR customer-portal URL — cancel the
  // subscription, see invoices/PII — so it must require the operator even if a
  // deploy forgot KP_OPERATOR_PASSWORD (no-op in that open-by-design dev mode;
  // enforced when set, matching proxy.ts).
  const denied = await requireOperator();
  if (denied) return denied;
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  const customerId = getBillingState()?.providerCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: "No billing customer yet — complete a checkout first." }, { status: 404 });
  }
  try {
    return NextResponse.json(await gateway.createPortalSession(customerId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Portal session failed." },
      { status: 502 }
    );
  }
}
