import { NextRequest, NextResponse } from "next/server";
import { deliver } from "@/app/_lib/ats-egress";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// P1-5 — send a signed `ping` to the configured webhook so an integrator can
// confirm reachability + signature verification before wiring real events. Reports
// the honest delivery result (HTTP status, or the failure reason) — it does NOT
// pretend success when the endpoint 4xx/5xx's or is unreachable.
//
// OPERATOR-only: this fires an authenticated server-side POST to a configured URL
// (an SSRF-adjacent probe surface) — the same trust level as editing the config.

// …and the operator gate is the ONLY thing that stood in front of an outbound network
// call, which open mode (KP_OPERATOR_PASSWORD unset) makes a documented no-op for the
// ENTIRE API. So the limiter is the real bound on the one button here that dials a
// third party: unthrottled, a loop turns kp into an amplifier pointed at whatever host
// the config names, and each answer is a reachability oracle for it (the SSRF guard
// vets the address, not the request RATE). 20/10min is far above a human clicking
// "Send test" while wiring an integration up.
const TEST_PING_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AFTER the operator gate, so a rejected caller never spends an operator's budget.
  if (!rateLimit(`ats-test:${clientIpFrom(request.headers)}`, TEST_PING_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const result = await deliver("ping", { ping: true });
  if (result.delivered) {
    return NextResponse.json({ ok: true, status: result.status });
  }
  return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
}
