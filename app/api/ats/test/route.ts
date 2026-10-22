import { NextRequest, NextResponse } from "next/server";
import { getAtsRecordResult, type deliver } from "@/app/_lib/ats-egress";
import { probeAtsWebhook } from "@/app/_lib/connect/probes";
import { egressSealed, SEALED } from "@/app/_lib/egress-seal";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";


// P1-5 — send a signed `ping` to the configured webhook so an integrator can
// confirm reachability + signature verification before wiring real events. Reports
// the honest delivery result (HTTP status, or the failure reason) — it does NOT
// pretend success when the endpoint 4xx/5xx's or is unreachable.
//
// Optional `{ entryId }` carries a real `kp.ats.v1` record as the ping's `data`
// so a receiver can be wired against the production field set without emitting a
// hire (`X-Kp-Event` stays `ping`; no ledger row, no Idempotency-Key). Omitted /
// `{}` keeps `{ ping: true }`.
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
const MAX_TEST_BODY_BYTES = 4 * 1024;

export const POST = withWorkspace(async (workspaceId: string, request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  // AFTER the operator gate, so a rejected caller never spends an operator's budget.
  if (!rateLimit(`ats-test:${clientIpFrom(request.headers)}`, TEST_PING_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  // Sealed: say so before reading the body or building a record, and dial nothing.
  if (egressSealed()) return NextResponse.json({ ok: false, sealed: true, reason: SEALED }, { status: 409 });
  const body = await readJsonWithLimit<{ entryId?: unknown }>(request, MAX_TEST_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) {
    return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_TEST_BODY_BYTES });
  }
  let data: Parameters<typeof deliver>[1] = { ping: true };
  if (body.entryId !== undefined && body.entryId !== null && body.entryId !== "") {
    if (typeof body.entryId !== "string") return jsonRefusal("ATS_CANDIDATE_NOT_FOUND", 404);
    const { record, refusal } = getAtsRecordResult(body.entryId, workspaceId);
    if (refusal) {
      console.info(`[ats] test ping refused for ${body.entryId}: ${refusal.reason}`);
      return jsonRefusal("ATS_CANDIDATE_ERASED", 410);
    }
    if (!record) return jsonRefusal("ATS_CANDIDATE_NOT_FOUND", 404);
    data = record;
  }
  // The ping itself lives in connect/probes.ts so the connector catalog sends the SAME one.
  const result = await probeAtsWebhook(data);
  if (result.kind === "http") return NextResponse.json({ ok: true, status: result.status });
  return NextResponse.json({ ok: false, reason: result.kind === "failed" || result.kind === "not_configured" ? result.reason : SEALED }, { status: 400 });
});
