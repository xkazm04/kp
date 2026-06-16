import { NextRequest, NextResponse } from "next/server";
import { BillingConfigError, ingestBillingWebhook, polarGatewayFromEnv } from "@/app/_lib/billing";
import { WebhookVerificationError } from "@/app/_lib/billing/webhook-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provider → us. The ONLY write path for money state (billing_state /
// billing_credits): signature-verified (standard-webhooks HMAC), idempotent on
// the provider event id, reduced by the pure reducer, applied in sync.ts.
// Register this endpoint + secret in the Polar dashboard (docs/BILLING.md).

export async function POST(request: NextRequest) {
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  // Raw body required: any re-serialization changes the bytes and breaks the MAC.
  const rawBody = await request.text();
  const headers = {
    "webhook-id": request.headers.get("webhook-id"),
    "webhook-timestamp": request.headers.get("webhook-timestamp"),
    "webhook-signature": request.headers.get("webhook-signature"),
  };
  try {
    const result = ingestBillingWebhook(gateway, rawBody, headers);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof BillingConfigError) {
      // Operator setup gap (e.g. secret not yet pasted) — say so; the provider
      // retries non-2xx, so deliveries succeed once the env is fixed.
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[billing:webhook] ingest failed", error);
    // Non-2xx → the provider retries; right call for a transient apply failure.
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
