import { NextRequest, NextResponse } from "next/server";
import { SEALED } from "@/app/_lib/egress-seal";
import { probeRelay } from "@/app/_lib/connect/probes";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { withSession } from "@/app/_lib/auth/workspace-context";

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

export const POST = withSession(async (request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  // AFTER the authority gates, so a refused caller never spends the budget, and before
  // the relay is resolved (which decrypts the stored signing secret).
  if (!rateLimit(`comms-relay-test:${clientIpFrom(request.headers)}`, PROBE_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  // The probe itself lives in connect/probes.ts so the connector catalog sends the SAME
  // ping; this route only maps its result to the response the Channels card renders. The
  // egress seal answers inside it BEFORE the relay is resolved: "sealed" must not be
  // reported as "not configured".
  const result = await probeRelay();
  if (result.kind === "sealed") return NextResponse.json({ ok: false, sealed: true, reason: SEALED }, { status: 409 });
  if (result.kind === "http") return NextResponse.json({ ok: result.ok, status: result.status });
  return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
});
