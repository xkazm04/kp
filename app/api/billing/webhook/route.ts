import { NextRequest, NextResponse } from "next/server";
import { BillingConfigError, ingestBillingWebhook, polarGatewayFromEnv } from "@/app/_lib/billing";
import { WebhookVerificationError } from "@/app/_lib/billing/webhook-verify";
import { readTextWithLimit } from "@/app/_lib/request-body";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// Provider → us. The ONLY write path for money state (billing_state /
// billing_credits): signature-verified (standard-webhooks HMAC), idempotent on
// the provider event id, reduced by the pure reducer, applied in sync.ts.
// Register this endpoint + secret in the Polar dashboard (docs/features/billing/README.md).

/** Hard budget for the raw delivery. A Polar event is ONE subscription or order
 *  object — a few KB of JSON even with the product, its prices and our metadata
 *  expanded — so this is orders of magnitude above any real payload while still
 *  bounding what an anonymous caller can make us allocate. */
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/** The one money door with no session and no capability gate: a MACHINE posts here,
 *  so the operator gate would 401 Polar and the public allow-list lets anyone reach
 *  it. Every other spend door is limited; this one was not, which left an anonymous
 *  caller free to loop 256 KB bodies through an HMAC verify and a SQLite transaction.
 *
 *  DELIBERATELY GENEROUS. Bursts from the provider are legitimate — a plan change
 *  fans out to several subscription events, and a redelivery storm after an outage
 *  replays a backlog — and with KP_TRUSTED_PROXY unset `clientIpFrom` collapses every
 *  caller into ONE shared bucket, so a tight ceiling would drop real money events.
 *  600/10 min is one delivery per second sustained: unreachable by any real Polar
 *  traffic, and still a bound on an attacker. A refused delivery answers 429, which
 *  is non-2xx, so the provider re-delivers it rather than losing it. */
const WEBHOOK_RATE_LIMIT = { limit: 600, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  const gateway = polarGatewayFromEnv();
  if (!gateway) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  // BEFORE the body read, not after: bounding what an anonymous caller can make us
  // ALLOCATE is the point — the 256 KB cap below bounds ONE request, this bounds the
  // RATE of them. The unconfigured 503 above keeps serving freely: it costs an env
  // read and tells an operator their setup is incomplete.
  if (!rateLimit(`billing-webhook:${clientIpFrom(request.headers)}`, WEBHOOK_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
