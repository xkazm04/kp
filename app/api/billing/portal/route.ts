import { NextResponse } from "next/server";
import { polarGatewayFromEnv } from "@/app/_lib/billing";
import { getBillingState } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer portal (manage/cancel the subscription, download MoR invoices):
// mints a provider customer-session and returns its URL. Needs a synced
// customer id, i.e. at least one completed checkout.

export async function POST() {
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
