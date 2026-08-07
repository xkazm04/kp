import { NextRequest } from "next/server";
import { recordOutbox } from "@/app/_lib/db";
import { isBounceOutcome } from "@/app/_lib/comms-status";
import { jsonError, jsonOk, safeJsonError } from "@/app/_lib/api-response";


// CW-2 (communications-inbound-channels #2) — the relay delivery-status callback.
// The WebhookChannel marks a message `sent` on the relay's HTTP 2xx, which means
// only "the relay ACCEPTED the POST", not "the candidate received it". The
// outcomes that actually matter for email — a hard bounce, a spam complaint, a
// drop — are ASYNCHRONOUS and arrive later out-of-band. This endpoint is where a
// configured relay (SendGrid/Mailgun/Postmark/an ATS) POSTs those receipts back,
// keyed by the message's `ref` (pipeline entry id) + `kind`. A bounce-class
// outcome is recorded as an append-only `bounced` receipt row that supersedes the
// green `sent` in the Comms Center (see comms-view.ts `deriveCommsView`), so a
// recruiter chases an undeliverable offer instead of trusting a false "sent".
//
// AUTH: fail-closed shared secret. The endpoint is DISABLED (503) unless
// COMMS_CALLBACK_SECRET is set, and then every call must present it as
// `x-comms-secret` (or `?secret=`). A deployment opts in deliberately; an
// unconfigured deployment can't be poked by a forged receipt. Document the secret
// alongside COMMS_WEBHOOK_URL in docs/COMMS_DELIVERY.md.
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.COMMS_CALLBACK_SECRET;
    if (!secret) {
      return jsonError(null, "Delivery callbacks are not enabled (set COMMS_CALLBACK_SECRET).", 503);
    }
    const presented = request.headers.get("x-comms-secret") ?? request.nextUrl.searchParams.get("secret");
    if (presented !== secret) {
      return jsonError(null, "Unauthorized.", 401);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return jsonError(null, "Expected a JSON delivery receipt.", 400);
    }
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
    if (!ref || !kind || !outcome) {
      return jsonError(null, "ref, kind and outcome are required.", 400);
    }

    // Positive/soft outcomes (delivered/opened/deferred) are accepted so the relay
    // stops retrying, but not yet surfaced — only the hard, reputation-critical
    // ones record a bounce receipt that flips the sent badge.
    if (!isBounceOutcome(outcome)) {
      return jsonOk({ recorded: false, outcome });
    }

    const detail = typeof body.detail === "string" && body.detail.trim() ? body.detail.trim() : outcome;
    const recipient =
      typeof body.recipient === "string" && body.recipient.trim() ? body.recipient.trim() : "(relay callback)";
    recordOutbox({
      recipient,
      subject: "Delivery receipt",
      body: detail,
      kind,
      channel: "relay-callback",
      status: "bounced",
      ref,
    });
    return jsonOk({ recorded: true, outcome });
  } catch (error) {
    return safeJsonError(error, "api:comms:callback", "OUTREACH_FAILED");
  }
}
