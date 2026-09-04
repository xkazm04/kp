import { NextRequest, NextResponse } from "next/server";
import { getHiredAgent, recordAgentLifecycle, updateHiredAgentStatus, type AgentStatus, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { createPipelineEntry, setPipelineEntryStage } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { stageForRole } from "@/app/_lib/pipeline-axis-server";
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

// Per IP, and the same reasoning as the catalog door beside it: this is the PULL
// half of the bridge, so every call dials the Personas app (and, on a state change,
// writes the roster row and files a pipeline card). `requireOperator()` is a
// documented no-op in open mode, so the budget is the real bound.
//
// 120/10 min, deliberately laxer than dispatch's 10 and matching the pairing CLAIM
// poll: this door is POLLED. The roster refreshes a row per operator click and the
// panel walks several rows while a hire is being approved, so a dispatch-sized
// ceiling would refuse the honest wait it exists for.
const REFRESH_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

// The actor the activation board move is attributed to — the decision-chain
// "auto:*" | "human:*" vocabulary. The poll is machine-initiated; naming the
// operator who clicked Refresh would credit them with a hire they did not make.
const AGENT_BRIDGE_ACTOR = "auto:agent-bridge";

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
    // AFTER the two cheap refusals above (unknown agent, never dispatched): a call
    // that could never reach Personas must not spend the window, and an operator
    // whose real answer is "re-dispatch it" must not be told to slow down.
    if (!rateLimit(`agent-refresh:${clientIpFrom(request.headers)}`, REFRESH_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
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
      // Same activation move the push report performs (idempotent entry
      // resolution via the m-<candidate>-<job> id scheme), and the same two
      // corrections: both stages are resolved BY ROLE off THIS workspace's axis
      // rather than written as the literals "Offer"/"Hired" (a renamed board
      // otherwise gets a row on a column it does not render, which the store now
      // refuses outright), and the move carries the `expectedStage` CAS so a
      // recruiter move that landed between the entry read and this write is not
      // silently overwritten by a poll.
      const offerStage = stageForRole("offer", ws) ?? stageForRole("entry", ws);
      const terminalStage = stageForRole("terminal", ws);
      const { entry } = createPipelineEntry({
        candidateId: `agent-${agent.id}`,
        candidateLabel: updated?.personaName ?? agent.jobTitle,
        jobId: agent.jobId,
        jobTitle: agent.jobTitle,
        ...(offerStage ? { stage: offerStage } : {}),
        sourceChannel: "agent-bridge",
        workspaceId: ws,
      });
      if (terminalStage && terminalStage !== entry.stage) {
        setPipelineEntryStage(entry.id, terminalStage, { expectedStage: entry.stage, actorRef: AGENT_BRIDGE_ACTOR }, ws);
      }
    }
    return NextResponse.json({ agent: safeAgent(updated), refreshed: true, personasStatus: polled.status });
  } catch (error) {
    return safeJsonError(error, "api:agents/refresh", "AGENT_REFRESH_FAILED");
  }
}
