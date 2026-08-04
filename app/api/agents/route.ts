import { NextResponse } from "next/server";
import { getAgentAggregates, listHiredAgents } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";

// Agent-candidate bridge — GET the roster: every hired agent in the caller's
// workspace with its live aggregates (runs, success rate, cost, connector use).
// The report token NEVER leaves the server through this read — it is the auth
// capability of the public report endpoint, not roster data.

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const agents = listHiredAgents(ws).map((agent) => {
      const { reportToken, ...safe } = agent;
      void reportToken; // stripped: the token is the report route's auth capability
      return { ...safe, aggregates: getAgentAggregates(agent.id, ws) };
    });
    return NextResponse.json({ agents });
  } catch (error) {
    return safeJsonError(error, "api:agents", "AGENT_LIST_FAILED");
  }
}
