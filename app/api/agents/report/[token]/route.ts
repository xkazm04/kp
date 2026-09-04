import { NextRequest, NextResponse } from "next/server";
import { getHiredAgentByReportToken, recordAgentExecution, recordAgentLifecycle, recordAgentReportReceipt, updateHiredAgentStatus, upsertAgentRollup, type AgentStatus, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { createPipelineEntry, recordAutomationEvent, setPipelineEntryStage } from "@/app/_lib/db/pipeline";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { parseAgentReport, type AgentReport, type LifecycleReport } from "@/app/_lib/agent-hire/report-payload";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { readTextWithLimit } from "@/app/_lib/request-body";
import { claimWebhookIdempotency, releaseWebhookIdempotency, webhookIdempotencyKey } from "@/app/_lib/webhook-idempotency";

// Agent-candidate bridge — the PUBLIC inbound report receiver. The hired Personas
// agent POSTs execution events, period rollups and lifecycle transitions here;
// the CSPRNG report token (minted at dispatch, hired_agents.report_token) is the
// ONLY auth, exactly the channel inbound webhook's model:
//   200 {result: accepted|duplicate_ignored} · 400 not JSON / bad shape ·
//   404 unknown or retired token · 413 too large · 429 rate-limited
//
// The route is listed in public-routes.ts (/api/agents/report/) so the proxy's
// session gate doesn't 401 the machine caller before this token auth runs.
// WORKSPACE COMES FROM THE TOKEN ROW, NEVER FROM THE PAYLOAD.

const MAX_REPORT_BODY_BYTES = 64 * 1024;

// Abuse containment for a public endpoint. Per token+IP; an agent reporting one
// event per run stays far under it, a flood is shed before the DB is touched.
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

// Lifecycle event → hired_agents.status. `approved` lands in onboarding (the
// human approved the request; Personas builds/configures next); `activated`
// flips the agent live AND auto-moves its pipeline row to Hired.
//
// `probation_review` is the one event whose status is NOT a constant: the day-N
// review's DECISION is the transition (concept §2.3). `extended` deliberately
// maps back to `onboarding` — more probation is not a promotion, and showing it
// as one would put a green "Active" on an agent a human just declined to
// activate.
const LIFECYCLE_STATUS: Record<Exclude<LifecycleReport["event"], "probation_review">, AgentStatus> = {
  approved: "onboarding",
  onboarding: "onboarding",
  activated: "active",
  rejected: "rejected",
  retired: "retired",
};

const PROBATION_STATUS = {
  activated: "active",
  extended: "onboarding",
  retired: "retired",
} as const satisfies Record<"activated" | "extended" | "retired", AgentStatus>;

function statusFor(report: LifecycleReport): AgentStatus {
  if (report.event === "probation_review") {
    // parseAgentReport refuses a probation_review with no decision, so this
    // fallback is unreachable — it exists so the union stays total.
    return report.decision ? PROBATION_STATUS[report.decision] : "onboarding";
  }
  return LIFECYCLE_STATUS[report.event];
}

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
  const status = statusFor(report);
  recordAgentLifecycle(
    agent.id,
    {
      event: report.event === "probation_review" ? `probation_review:${report.decision}` : report.event,
      reason: report.note ?? report.reason,
      raw: report,
    },
    ws
  );
  updateHiredAgentStatus(agent.id, status, { personaId: report.personaId, personaName: report.personaName }, ws);
  // A probation review that ACTIVATES lands the agent live for the first time,
  // so it takes the same board move as a plain `activated` event.
  if ((report.event === "activated" || (report.event === "probation_review" && report.decision === "activated")) && agent.jobId) {
    // The agent's pipeline row was created at dispatch with the same identity, so
    // this idempotent re-create resolves the SAME entry (the m-<candidate>-<job>
    // id scheme) whether or not it still exists, then moves it to Hired.
    const { entry } = createPipelineEntry({
      candidateId: `agent-${agent.id}`,
      candidateLabel: agent.personaName ?? report.personaName ?? agent.jobTitle,
      jobId: agent.jobId,
      jobTitle: agent.jobTitle,
      stage: "Offer",
      sourceChannel: "agent-bridge",
      workspaceId: ws,
    });
    setPipelineEntryStage(entry.id, "Hired", undefined, ws);
    recordAutomationEvent(entry.id, "agent_activated", `Personas persona ${report.personaId ?? agent.personaId ?? ""} went live`, ws);
  }
  return { result: "accepted" };
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  // Released in the catch if processing fails, so a genuine retry can re-run.
  let claimedIdemKey: string | null = null;
  try {
    const { token } = await context.params;
    if (!rateLimit(`agent-report:${token}:${clientIpFrom(request.headers)}`, RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
    // body hash). Execution events ALSO carry durable DB idempotency on exec_id
    // and rollups upsert by period, so a replay outside this TTL still can't
    // double-count — this claim just short-circuits the common retry storm.
    const idemKey = `agent-report:${token}:${webhookIdempotencyKey(
      rawBody,
      request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key")
    )}`;
    if (!claimWebhookIdempotency(idemKey)) {
      return NextResponse.json({ result: "duplicate_ignored", duplicate: true }, { status: 200 });
    }
    claimedIdemKey = idemKey;

    const outcome = applyReport(agent, parsed.report);
    return jsonOk({ ...outcome, kind: parsed.report.kind });
  } catch (error) {
    // Processing failed → the sender will retry; release the claim so the retry
    // isn't wrongly treated as a duplicate of work that never completed.
    if (claimedIdemKey) releaseWebhookIdempotency(claimedIdemKey);
    return safeJsonError(error, "api:agents/report", "AGENT_REPORT_FAILED");
  }
}
