import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { setBridgeConfig } from "@/app/_lib/agent-hire/bridge-store";
import { claimPairing, startPairing, type PairFailure } from "@/app/_lib/agent-hire/pairing";

// Agent-candidate bridge — the two-phase Personas pairing flow (operator-gated):
//   POST {phase:"start", baseUrl?}       → registers a pairing request, returns
//                                          {nonce} for the UI to poll with;
//   POST {phase:"claim", nonce}          → ONE claim attempt: {paired:false,
//                                          state:"pending"} until the human
//                                          approves in the Personas desktop app,
//                                          then the pk_ key is stored encrypted
//                                          and {paired:true} returns.
// Split into phases (rather than one long-blocking request) so the human has the
// full 300s TTL to approve without the route holding a connection open.

// THROTTLE (rate-limit-contract.test.ts). Both phases reach OUT of the process —
// start registers a pairing request with Personas (and persists the base URL it was
// pointed at), claim redeems a single-use nonce for a pk_ key — under an operator
// gate that open mode makes a documented no-op. The two budgets differ because the
// traffic does: a human starts a pairing a few times, while the panel POLLS claim
// for up to the 300s TTL along a 2s→15s backoff (~30 requests per pairing).
const PAIR_START_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };
const PAIR_CLAIM_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

/** A refused phase, told apart by WHOSE fault it is. A `code` on the failure
 *  means kp itself is not in a state to pair (today: no at-rest secret to store
 *  the pk_ key under) — that is a 503 the operator fixes in their own env, and
 *  the UI resolves the code through the `errors` catalog in their language. A
 *  code-less failure came from the far end, which is what 502 means. Reporting
 *  the misconfiguration as 502 read as "Personas is down" and sent operators
 *  restarting a desktop app that was answering perfectly. */
function refusal(result: PairFailure): NextResponse {
  // One coded failure is the FAR END's doing: an oversized bridge answer (wave 38c
  // bounds every bridge read) says nothing about kp's env, so it keeps the code the
  // UI localizes but carries the 502 the status contract means by "upstream".
  if (result.code === "AGENT_BRIDGE_RESPONSE_TOO_LARGE") {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 502 });
  }
  return result.code
    ? NextResponse.json({ error: result.error, code: result.code }, { status: 503 })
    : NextResponse.json({ error: result.error }, { status: 502 });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as {
      phase?: unknown;
      nonce?: unknown;
      baseUrl?: unknown;
    } | null;
    const phase = body?.phase;

    if (phase === "start") {
      // Ahead of the baseUrl WRITE as well as the outbound call: a throttled start
      // must not re-point this deployment at someone else's Personas either.
      if (!rateLimit(`agent-pair:${clientIpFrom(request.headers)}`, PAIR_START_RATE_LIMIT)) {
        return jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      // An explicit baseUrl persists before the request runs, so start doubles
      // as the "point kp at my Personas" write.
      if (typeof body?.baseUrl === "string") setBridgeConfig({ baseUrl: body.baseUrl });
      const started = await startPairing();
      if (!started.ok) return refusal(started);
      return NextResponse.json({ nonce: started.nonce, expiresInS: started.expiresInS });
    }

    if (phase === "claim") {
      const nonce = typeof body?.nonce === "string" ? body.nonce : "";
      if (!nonce) return NextResponse.json({ error: "nonce is required for the claim phase." }, { status: 400 });
      // After the shape refusal (a bodyless poll spends nothing) and before the
      // outbound GET that can redeem the key.
      if (!rateLimit(`agent-pair-claim:${clientIpFrom(request.headers)}`, PAIR_CLAIM_RATE_LIMIT)) {
        return jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      const claimed = await claimPairing(nonce);
      if (!claimed.ok) return refusal(claimed);
      return NextResponse.json(claimed.paired ? { paired: true } : { paired: false, state: "pending" });
    }

    return NextResponse.json({ error: 'phase must be "start" or "claim".' }, { status: 400 });
  } catch (error) {
    return safeJsonError(error, "api:agents/pair", "AGENT_PAIR_FAILED");
  }
}
