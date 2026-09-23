import { NextRequest, NextResponse } from "next/server";
import { getHiredAgent, transitionHiredAgent, type HiredAgentRecord } from "@/app/_lib/db/agents";
import { lifecycleEventName, lifecycleTarget, placeAgentOnBoard } from "@/app/_lib/agent-hire/lifecycle";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
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

/** The wire projection of a hired agent — everything except the report token. */
function safeAgent(agent: HiredAgentRecord | null): Omit<HiredAgentRecord, "reportToken"> | null {
  if (!agent) return null;
  const { reportToken, ...safe } = agent;
  void reportToken; // stripped: the token is the report route's auth capability
  return safe;
}

// Personas' poll words map onto AgentStatus through lifecycleTarget() — the SAME
// function the push report uses (agent-hire/lifecycle.ts); this route keeps no
// private copy of the vocabulary.

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). A poll reads like a read, but
  // its whole point is the write on the other side: an `active` reply flips the
  // roster row AND files/moves the agent's pipeline entry into the terminal column.
  // A viewer must not be able to land a hire on the board by clicking Refresh, so
  // this asks the same capability the push path's own board move would need —
  // `pipeline:write`. The dial-out throttle stays below, after the two cheap
  // refusals it was placed after.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
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
    const signal = { kind: "poll" as const, status: polled.status };
    const mapped = lifecycleTarget(signal);
    if (!mapped || mapped === agent.status) {
      return NextResponse.json({ agent: safeAgent(agent), refreshed: false, personasStatus: polled.status });
    }
    // The row was read BEFORE the network call above; the push report may have
    // moved it while the poll was on the wire. transitionHiredAgent re-asserts
    // the status this decision was computed from (`from: agent.status`) inside
    // one IMMEDIATE transaction — a CAS, so a stale poll is dropped (and ledgered
    // as refused) instead of overwriting the newer state. No await sits inside it.
    const transition = transitionHiredAgent(
      id,
      {
        from: agent.status,
        to: mapped,
        event: lifecycleEventName(signal),
        personaId: polled.personaId,
        personaName: polled.personaName,
      },
      ws
    );
    if (!transition.applied) {
      return NextResponse.json({
        agent: safeAgent(transition.agent),
        refreshed: false,
        result: "transition_refused",
        personasStatus: polled.status,
      });
    }
    const updated = transition.agent;
    // The SAME activation board move the push report performs: role-resolved
    // stages, the expectedStage CAS, and the `agent_activated` marker (which
    // this path used to skip). An App-master hire from an intake has no jobId,
    // so placeAgentOnBoard files nothing for it.
    if (mapped === "active" && updated) {
      placeAgentOnBoard(updated, "hired", ws, { label: updated.personaName, personaId: polled.personaId });
    }
    return NextResponse.json({ agent: safeAgent(updated), refreshed: true, personasStatus: polled.status });
  } catch (error) {
    return safeJsonError(error, "api:agents/refresh", "AGENT_REFRESH_FAILED");
  }
}
