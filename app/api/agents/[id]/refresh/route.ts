import { NextRequest, NextResponse } from "next/server";
import { getHiredAgent, recordAgentLifecycle, updateHiredAgentStatus, type AgentStatus, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { createPipelineEntry, setPipelineEntryStage } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { fetchRequestStatus } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — POST polls Personas for the request's state (the PULL
// fallback for deployments where the push report path can't reach kp). The push
// path (/api/agents/report/[token]) stays the primary contract; this maps the
// same lifecycle states onto the row, including the activated → Hired move.
//
// Like the roster read (GET /api/agents), the response carries the SAFE agent
// projection: report_token is the ONLY auth on the public report endpoint, so it
// never crosses the wire — a client holding it could POST lifecycle/execution
// reports for this agent with no session at all.

/** The wire projection of a hired agent — everything except the report token. */
function safeAgent(agent: HiredAgentRecord | null): Omit<HiredAgentRecord, "reportToken"> | null {
  if (!agent) return null;
  const { reportToken, ...safe } = agent;
  void reportToken; // stripped: the token is the report route's auth capability
  return safe;
}

const STATUS_MAP: Record<string, AgentStatus> = {
  pending: "pending_approval",
  pending_approval: "pending_approval",
  approved: "onboarding",
  onboarding: "onboarding",
  building: "onboarding",
  active: "active",
  activated: "active",
  rejected: "rejected",
  retired: "retired",
  // Personas-side terminal states beyond the original enum: expired = the
  // approval sat past the 24h consent window; failed = the human approved but
  // the executor couldn't create the persona. Both terminal, both free the job
  // for a re-dispatch (the dispatch route's one-live-agent rule).
  expired: "failed",
  failed: "failed",
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const agent = getHiredAgent(id, ws);
    if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    if (!agent.requestId) {
      // A CODE, not just English prose: this branch is the one an operator can act
      // on (re-dispatch), and the row resolves `errors.<CODE>` in the reader's
      // language. Shipping only `reason` landed every non-English operator on the
      // generic "couldn't refresh" sentence, which names no remedy at all.
      return NextResponse.json({
        agent: safeAgent(agent),
        refreshed: false,
        reason: "No Personas request to poll (dispatch failed?).",
        code: "AGENT_REFRESH_NOT_DISPATCHED",
      });
    }
    const polled = await fetchRequestStatus(agent.requestId);
    if (!polled.ok) {
      // A poll failure is not a route failure (the push path is the primary
      // contract), but the REASON matters: `AGENT_BRIDGE_KEY_INVALID` says the
      // pairing key is dead — a 24h headless auto-pair key expired — which the
      // operator fixes by re-pairing rather than by waiting for Personas.
      return NextResponse.json({
        agent: safeAgent(agent),
        refreshed: false,
        reason: polled.error,
        ...(polled.code ? { code: polled.code } : {}),
      });
    }
    const mapped = STATUS_MAP[polled.status.toLowerCase()];
    if (!mapped || mapped === agent.status) {
      return NextResponse.json({ agent: safeAgent(agent), refreshed: false, personasStatus: polled.status });
    }
    const updated = updateHiredAgentStatus(id, mapped, { personaId: polled.personaId, personaName: polled.personaName }, ws);
    recordAgentLifecycle(id, { event: `poll:${polled.status}` }, ws);
    // `agent.jobId` guard: an App-master hire dispatched from an intake owns an
    // application, not a job posting, so it has no board column — filing one
    // would invent a candidate for a job nobody is hiring for.
    if (mapped === "active" && agent.jobId) {
      // Same activated → Hired move the push report performs (idempotent entry
      // resolution via the m-<candidate>-<job> id scheme).
      const { entry } = createPipelineEntry({
        candidateId: `agent-${agent.id}`,
        candidateLabel: updated?.personaName ?? agent.jobTitle,
        jobId: agent.jobId,
        jobTitle: agent.jobTitle,
        stage: "Offer",
        sourceChannel: "agent-bridge",
        workspaceId: ws,
      });
      setPipelineEntryStage(entry.id, "Hired", undefined, ws);
    }
    return NextResponse.json({ agent: safeAgent(updated), refreshed: true, personasStatus: polled.status });
  } catch (error) {
    return safeJsonError(error, "api:agents/refresh", "AGENT_REFRESH_FAILED");
  }
}
