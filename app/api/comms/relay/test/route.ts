import { NextRequest, NextResponse } from "next/server";
import { resolveRelay } from "@/app/_lib/comms-relay";
import { buildCommEnvelope } from "@/app/_lib/comms-envelope";
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from "@/app/_lib/ats-webhook";
import { assertPublicHttpsEndpoint } from "@/app/_lib/safe-url";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { COMMS_PROBE_TIMEOUT_MS, relayTimeoutMs } from "@/app/_lib/comms";

// Send a signed `relay.test` envelope to the ACTIVE relay (env → stored config)
// so an integrator can confirm reachability + signature verification before any
// real candidate message rides the wire. Honest result: the endpoint's HTTP
// status, or the failure reason — never a pretend success. Single attempt, no
// retry (a probe should answer fast, not back off).
//
// OPERATOR-only: an authenticated server-side POST to a configured URL (an
// SSRF-adjacent probe surface) — the same trust level as editing the config. Which is
// why it is also gated on `org:manage` and throttled exactly like that config door
// (/perfect wave 27, api-comms): every accepted call spends one outbound request from
// this deployment's address at a URL the caller can re-point through POST
// /api/comms/relay, and each answer is a reachability oracle for that host. Nothing
// bounded the RATE, so a loop turned kp into an amplifier — the same hole
// /api/ats/test had. 20/10min is far above an operator clicking "Send test" while
// wiring a relay up.
const PROBE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  // AFTER the authority gates, so a refused caller never spends the budget, and before
  // the relay is resolved (which decrypts the stored signing secret).
  if (!rateLimit(`comms-relay-test:${clientIpFrom(request.headers)}`, PROBE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const relay = resolveRelay();
  if (!relay) {
    return NextResponse.json({ ok: false, reason: "No relay configured." }, { status: 400 });
  }
  // Re-vet a STORED url at fetch time (rules can tighten after a write; env stays
  // the operator's own responsibility, matching the delivery path).
  if (relay.source === "config") {
    try {
      assertPublicHttpsEndpoint(relay.url, "relay url");
    } catch (e) {
      return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "Relay URL not allowed." }, { status: 400 });
    }
  }
  const envelope = buildCommEnvelope(
    { to: "relay-test", subject: "kp relay test", body: "Test ping from the kp delivery relay configuration.", kind: "relay.test" },
    null,
    new Date().toISOString()
  );
  const body = JSON.stringify(envelope);
  // Same construction as a real relay delivery (comms.ts), so a receiver wired up
  // against this ping is wired up against production traffic.
  const headers: Record<string, string> = { "Content-Type": "application/json", [TIMESTAMP_HEADER]: envelope.sentAt };
  if (relay.secret) headers[SIGNATURE_HEADER] = signWebhookBody(relay.secret, body, envelope.sentAt);
  // Bounded like a real delivery (comms.ts), tighter: a human is watching a button, and
  // a relay that cannot answer a ping inside the window has failed the very question
  // the probe asks. Without this the handler hung for as long as the receiver liked.
  const timeoutMs = relayTimeoutMs(COMMS_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(relay.url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (error) {
    // `reason` is the probe's own diagnostic channel, rendered verbatim by the relay
    // card next to the endpoint the operator just typed — that is the whole point of a
    // test ping, so it stays prose. A timeout gets a sentence the platform's generic
    // abort message does not give.
    const reason =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? `timeout after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "network error";
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
}
