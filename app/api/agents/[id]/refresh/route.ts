import { NextRequest, NextResponse } from "next/server";
import {
  createPipelineEntry,
  getHiredAgent,
  recordAgentLifecycle,
  setPipelineEntryStage,
  updateHiredAgentStatus,
  type AgentStatus,
} from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { fetchRequestStatus } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — POST polls Personas for the request's state (the PULL
// fallback for deployments where the push report path can't reach kp). The push
// path (/api/agents/report/[token]) stays the primary contract; this maps the
// same lifecycle states onto the row, including the activated → Hired move.

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
      return NextResponse.json({ agent, refreshed: false, reason: "No Personas request to poll (dispatch failed?)." });
    }
    const polled = await fetchRequestStatus(agent.requestId);
    if (!polled.ok) {
      return NextResponse.json({ agent, refreshed: false, reason: polled.error });
    }
    const mapped = STATUS_MAP[polled.status.toLowerCase()];
    if (!mapped || mapped === agent.status) {
      return NextResponse.json({ agent, refreshed: false, personasStatus: polled.status });
    }
    const updated = updateHiredAgentStatus(id, mapped, { personaId: polled.personaId, personaName: polled.personaName }, ws);
    recordAgentLifecycle(id, { event: `poll:${polled.status}` }, ws);
    if (mapped === "active") {
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
    return NextResponse.json({ agent: updated, refreshed: true, personasStatus: polled.status });
  } catch (error) {
    return safeJsonError(error, "api:agents/refresh", "AGENT_REFRESH_FAILED");
  }
}
