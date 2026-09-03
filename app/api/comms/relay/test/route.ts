import { NextResponse } from "next/server";
import { resolveRelay } from "@/app/_lib/comms-relay";
import { buildCommEnvelope } from "@/app/_lib/comms-envelope";
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from "@/app/_lib/ats-webhook";
import { assertPublicHttpsEndpoint } from "@/app/_lib/safe-url";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// Send a signed `relay.test` envelope to the ACTIVE relay (env → stored config)
// so an integrator can confirm reachability + signature verification before any
// real candidate message rides the wire. Honest result: the endpoint's HTTP
// status, or the failure reason — never a pretend success. Single attempt, no
// retry (a probe should answer fast, not back off).
//
// OPERATOR-only: an authenticated server-side POST to a configured URL (an
// SSRF-adjacent probe surface) — the same trust level as editing the config.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
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
  try {
    const r = await fetch(relay.url, { method: "POST", headers, body });
    return NextResponse.json({ ok: r.ok, status: r.status });
  } catch (error) {
    return NextResponse.json({ ok: false, reason: error instanceof Error ? error.message : "network error" }, { status: 400 });
  }
}
