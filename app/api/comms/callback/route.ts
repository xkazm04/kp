import { NextRequest } from "next/server";
import { hasOutboxSendFor, recordOutbox } from "@/app/_lib/db";
import { isBounceOutcome } from "@/app/_lib/comms-status";
import { jsonError, jsonOk, safeJsonError } from "@/app/_lib/api-response";
import {
  secretsMatch,
  isTimestampFresh,
  callbackNonce,
  createReplayGuard,
  type ReplayGuard,
} from "./callback-auth.ts";

// Process-local replay/idempotency store, kept on globalThis so it survives a
// Next.js dev HMR reload (same pattern as the other in-memory singletons here).
const replayStore = globalThis as unknown as { __commsCallbackReplayGuard?: ReplayGuard };
const replayGuard: ReplayGuard = (replayStore.__commsCallbackReplayGuard ??= createReplayGuard());


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
// AUTH: fail-closed shared secret, hardened (communications-inbound-channels #4).
// The endpoint is DISABLED (503) unless COMMS_CALLBACK_SECRET is set. Every call
// must then present the secret ONLY in the `x-comms-secret` HEADER — the old
// `?secret=` query form was dropped because URLs are logged and forwarded by
// design (access/proxy logs, Referer), so a query-string secret leaks verbatim.
// The compare is constant-time and length-independent (secretsMatch). A caller
// timestamp header `x-comms-timestamp` (ISO-8601 or epoch-ms) must be within a
// ±5-minute window, and an in-process idempotency guard drops an exact replay
// inside that window — so a captured valid callback can't be replayed to forge or
// re-forge a bounce. A deployment opts in deliberately; an unconfigured one can't
// be poked. Document the secret + timestamp header alongside COMMS_WEBHOOK_URL in
// docs/features/comms/README.md.
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.COMMS_CALLBACK_SECRET;
    if (!secret) {
      return jsonError(null, "Delivery callbacks are not enabled (set COMMS_CALLBACK_SECRET).", 503);
    }
    // Header only — never the URL (no `?secret=`), and a constant-time compare.
    const presented = request.headers.get("x-comms-secret");
    if (!secretsMatch(presented, secret)) {
      return jsonError(null, "Unauthorized.", 401);
    }
    // Freshness window bounds how long a captured callback stays replayable.
    const nowMs = Date.now();
    const timestamp = request.headers.get("x-comms-timestamp");
    if (!isTimestampFresh(timestamp, nowMs)) {
      return jsonError(null, "Stale or missing callback timestamp.", 401);
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

    // Idempotency: an exact replay of this receipt (within the freshness window)
    // must not record a second bounce. Prefer a caller-supplied `x-comms-nonce`,
    // else derive one from the timestamp + receipt identity.
    const nonce = callbackNonce({
      timestamp,
      ref,
      kind,
      outcome,
      detail,
      explicitNonce: request.headers.get("x-comms-nonce"),
    });
    if (replayGuard.isReplay(nonce, nowMs)) {
      return jsonOk({ recorded: false, duplicate: true });
    }
    const recipient =
      typeof body.recipient === "string" && body.recipient.trim() ? body.recipient.trim() : "(relay callback)";
    // ORPHAN RECEIPTS (callback-unblocked): (ref, kind) is the ONLY key a receipt
    // carries, and the route used to validate it as merely non-empty — so a receipt
    // naming a pair kp never sent (an integrator on a different ref scheme, or a kind
    // we don't emit) was stored as truth and then displayed NOWHERE, because
    // deriveCommsView drops every bounce row that folds onto no send. That is a silent
    // integration failure: the relay reads 200 {recorded:true} while nothing lands.
    // Now the mismatch is answered on the FIRST call. The receipt is still stored —
    // append-only, and its orphan state is DERIVED (comms-view.ts), not frozen into a
    // column, so it self-heals into a normal fold if the send shows up out of order —
    // and comms-view surfaces it in the Comms Center's actionable set instead of
    // dropping it.
    const matched = hasOutboxSendFor(ref, kind);
    recordOutbox({
      recipient,
      subject: "Delivery receipt",
      body: detail,
      kind,
      channel: "relay-callback",
      status: "bounced",
      ref,
    });
    if (!matched) return jsonOk({ recorded: false, reason: "no_matching_send", stored: true, outcome });
    return jsonOk({ recorded: true, outcome });
  } catch (error) {
    return safeJsonError(error, "api:comms:callback", "OUTREACH_FAILED");
  }
}
