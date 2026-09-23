import { NextRequest, NextResponse } from "next/server";
import { getHiredAgentByReportToken, recordAgentExecution, recordAgentReportReceipt, transitionHiredAgent, upsertAgentRollup, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { lifecycleEventName, lifecycleTarget, placeAgentOnBoard } from "@/app/_lib/agent-hire/lifecycle";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { parseAgentReport, type AgentReport } from "@/app/_lib/agent-hire/report-payload";
import { clientIpFrom, rateLimit, rateLimitRetryAfterMs } from "@/app/_lib/rate-limit";
import { jsonThrottled } from "@/app/_lib/throttle-response";
import { readTextWithLimit } from "@/app/_lib/request-body";
import { claimWebhookIdempotency, releaseWebhookIdempotency, settleWebhookIdempotency, webhookIdempotencyKey } from "@/app/_lib/webhook-idempotency";

// Agent-candidate bridge — the PUBLIC inbound report receiver. The hired Personas
// agent POSTs execution events, period rollups and lifecycle transitions here;
// the CSPRNG report token (minted at dispatch, hired_agents.report_token) is the
// ONLY auth, exactly the channel inbound webhook's model:
//   200 {result: accepted|duplicate_ignored|transition_refused} · 400 not JSON / bad shape ·
//   404 unknown or retired token · 413 too large · 429 rate-limited
//
// The route is listed in public-routes.ts (/api/agents/report/) so the proxy's
// session gate doesn't 401 the machine caller before this token auth runs.
// WORKSPACE COMES FROM THE TOKEN ROW, NEVER FROM THE PAYLOAD.

const MAX_REPORT_BODY_BYTES = 64 * 1024;

// Abuse containment for a public endpoint. Per token+IP; an agent reporting one
// event per run stays far under it, a flood is shed before the DB is touched.
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

// Lifecycle reports go through the ONE transition door (agent-hire/lifecycle.ts):
// lifecycleTarget() maps the push event (a probation review by its DECISION —
// `extended` is onboarding → onboarding, more probation is not a promotion),
// transitionHiredAgent() refuses an illegal or stale move with a status CAS and
// writes the ledger row, and placeAgentOnBoard() is the activation board move the
// pull refresh shares. A refused move is answered 200 `transition_refused`: the
// report was understood, and a retry would be refused the same way, so Personas
// must not be told to retry it. That is how a REJECTED or FAILED hire's token
// stops moving anything — it still resolves (only a retired token 404s) so its
// late signals are recorded, but none of them revive the hire.

function applyReport(agent: HiredAgentRecord, report: AgentReport): { result: string; duplicate?: boolean } {
  const ws = agent.workspaceId;
  if (report.kind === "execution") {
    const { created } = recordAgentExecution(
      agent.id,
      {
        execId: report.execId,
        costUsd: report.costUsd,
        tokensIn: report.tokensIn,
        tokensOut: report.tokensOut,
        status: report.status,
        durationMs: report.durationMs,
        connectorUses: report.connectorUses,
        raw: report,
      },
      ws
    );
    // Durable idempotency by (agent, execId) — a replay is acknowledged, never recounted.
    return created ? { result: "accepted" } : { result: "duplicate_ignored", duplicate: true };
  }
  if (report.kind === "rollup") {
    upsertAgentRollup(
      agent.id,
      {
        period: report.period,
        runs: report.runs,
        successes: report.successes,
        failures: report.failures,
        costUsd: report.costUsd,
        tokensIn: report.tokensIn,
        tokensOut: report.tokensOut,
        connectorUses: report.connectorUses,
        // Reporter v2: the App-master backbone reading for the period. Stored in
        // the rollup's raw_json beside runs/successes/failures (same JSON column,
        // no migration); null when the sender reported none of it, which must
        // stay distinguishable from a sender reporting zeroes.
        backbone: report.backbone,
      },
      ws
    );
    return { result: "accepted" };
  }
  // lifecycle
  const signal = { kind: "push" as const, event: report.event, decision: report.decision };
  const target = lifecycleTarget(signal);
  // parseAgentReport refuses a probation_review with no decision, so a null
  // target is unreachable here; answered as a refusal so the union stays total.
  if (!target) return { result: "transition_refused" };
  const transition = transitionHiredAgent(
    agent.id,
    {
      from: agent.status,
      to: target,
      event: lifecycleEventName(signal),
      reason: report.note ?? report.reason,
      raw: report,
      personaId: report.personaId,
      personaName: report.personaName,
    },
    ws
  );
  if (!transition.applied) return { result: "transition_refused" };
  // An activation (a plain `activated`, or a probation review that ACTIVATES)
  // lands the agent live for the first time, so it takes the board move.
  if (target === "active") {
    placeAgentOnBoard(transition.agent ?? agent, "hired", ws, {
      label: agent.personaName ?? report.personaName,
      personaId: report.personaId,
    });
  }
  return { result: "accepted" };
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  // Released in the catch if processing fails, so a genuine retry can re-run.
  let claimedIdemKey: string | null = null;
  try {
    const { token } = await context.params;
    // The reporter is a machine: the 429 says when the window reopens (Retry-After).
    const limitKey = `agent-report:${token}:${clientIpFrom(request.headers)}`;
    if (!rateLimit(limitKey, RATE_LIMIT)) {
      return jsonThrottled(rateLimitRetryAfterMs(limitKey), RATE_LIMIT.windowMs);
    }

    // Unknown and retired tokens are deliberately indistinguishable (both 404).
    const agent = getHiredAgentByReportToken(token);
    if (!agent) return NextResponse.json({ error: "Unknown report token." }, { status: 404 });

    // LIVENESS RECEIPT, before the body is read — the same position the channels
    // inbound receiver stamps its receipt in. An operator staring at a silent
    // agent needs to tell "Personas never called" from "Personas is calling and
    // every payload is being rejected", and until this stamp existed both read as
    // the same absence: the aggregates' lastActivityAt only moves on an ACCEPTED
    // report, and the bridge's last_ok_at answers the OUTBOUND direction. An
    // unknown or retired token 404s above, so nothing is stamped for it.
    recordAgentReportReceipt(agent.id, agent.workspaceId);

    // content-length is advisory; the real cap is enforced on bytes read off the wire.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_REPORT_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    const rawBody = await readTextWithLimit(request, MAX_REPORT_BODY_BYTES);
    if (rawBody === null) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }

    // Deterministic shape rejection BEFORE the idempotency claim, so a retried
    // malformed report keeps getting the same actionable 400.
    const parsed = parseAgentReport(payload);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Request-level idempotency for raw replays (Idempotency-Key header, else a
    // body hash), held durably for the done-horizon once applied. Execution events
    // ALSO carry durable DB idempotency on exec_id and rollups upsert by period, so a
    // replay outside the horizon still can't double-count.
    const idemKey = `agent-report:${token}:${webhookIdempotencyKey(
      rawBody,
      request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key")
    )}`;
    if (!claimWebhookIdempotency(idemKey)) {
      return NextResponse.json({ result: "duplicate_ignored", duplicate: true }, { status: 200 });
    }
    claimedIdemKey = idemKey;

    const outcome = applyReport(agent, parsed.report);
    // Applied: the claim is DONE, durably (db/webhook-claims.ts), so a replay after a
    // restart short-circuits here instead of leaning on the downstream upserts alone.
    settleWebhookIdempotency(idemKey);
    claimedIdemKey = null;
    return jsonOk({ ...outcome, kind: parsed.report.kind });
  } catch (error) {
    // Processing failed → the sender will retry; release the claim so the retry
    // isn't wrongly treated as a duplicate of work that never completed.
    if (claimedIdemKey) releaseWebhookIdempotency(claimedIdemKey);
    return safeJsonError(error, "api:agents/report", "AGENT_REPORT_FAILED");
  }
}
