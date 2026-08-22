import { NextRequest, NextResponse } from "next/server";
import { BillingConfigError, ingestBillingWebhook, polarGatewayFromEnv } from "@/app/_lib/billing";
import { WebhookVerificationError } from "@/app/_lib/billing/webhook-verify";
import { readTextWithLimit } from "@/app/_lib/request-body";


// Provider → us. The ONLY write path for money state (billing_state /
// billing_credits): signature-verified (standard-webhooks HMAC), idempotent on
// the provider event id, reduced by the pure reducer, applied in sync.ts.
// Register this endpoint + secret in the Polar dashboard (docs/features/billing/README.md).

/** Hard budget for the raw delivery. A Polar event is ONE subscription or order
 *  object — a few KB of JSON even with the product, its prices and our metadata
 *  expanded — so this is orders of magnitude above any real payload while still
 *  bounding what an anonymous caller can make us allocate. */
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  // Raw body required: any re-serialization changes the bytes and breaks the MAC.
  //
  // BOUNDED, because this route is on the PUBLIC allow-list (public-routes.ts — a
  // MACHINE posts here, so the operator gate would 401 Polar) and the MAC covers the
  // body, so the body must be read BEFORE anything can be authenticated. `request.text()`
  // had no budget: any unauthenticated caller could stream hundreds of MB into the heap
  // and only then be answered 400. Same contract the other public machine endpoints use
  // (agents/report/[token], channels/inbound/[token]) — content-length is an advisory
  // fast-reject, the REAL cap aborts the stream on bytes actually read off the wire.
  // 413 is non-2xx, so a (impossible-in-practice) oversized genuine delivery is retried
  // and stays visible in the Polar dashboard rather than being silently swallowed.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  const rawBody = await readTextWithLimit(request, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
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
