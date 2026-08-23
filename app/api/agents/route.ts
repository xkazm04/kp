import { NextResponse } from "next/server";
import { getAgentAggregates, getLatestAgentRollupRaw, listHiredAgents } from "@/app/_lib/db/agents";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { backboneFromRollup, backboneScore, hasBackboneFields } from "@/app/_lib/app-master/backbone";
import { AUTOPILOT_MODES, type AutopilotMode } from "@/app/_lib/agent-hire/report-payload";

// Agent-candidate bridge — GET the roster: every hired agent in the caller's
// workspace with its live aggregates (runs, success rate, cost, connector use).
// The report token NEVER leaves the server through this read — it is the auth
// capability of the public report endpoint, not roster data.
//
// App-master rows (P4) carry two extras:
//   `appMaster` — the four fields the roster renders off the dispatched spec
//                 (population, mandate rung, probation days, autopilot mode).
//                 A PROJECTION, not the spec: the system prompt, the connector
//                 list and the forbidden-class vocabulary are not roster data.
//   `backbone`  — the deterministic performance verdict for the LATEST reported
//                 period, computed here from the rollup's stored reading. Null
//                 when nothing has reported a backbone yet, which is honest: a
//                 just-dispatched App master has no record, and rendering one
//                 out of six absent counters would be six fabricated zeroes.

/** The autopilot mode a rollup last reported, if it named a valid one. */
function autopilotOf(raw: unknown): AutopilotMode | null {
  const mode = (raw as { autopilotMode?: unknown } | null)?.autopilotMode;
  return typeof mode === "string" && (AUTOPILOT_MODES as readonly string[]).includes(mode) ? (mode as AutopilotMode) : null;
}

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const agents = listHiredAgents(ws).map((agent) => {
      const { reportToken, ...safe } = agent;
      void reportToken; // stripped: the token is the report route's auth capability

      const spec = agent.appMaster as
        | {
            role?: { population?: unknown };
            mandate?: { scopeRung?: unknown };
            tenure?: { probationDays?: unknown };
          }
        | null;
      if (!spec || typeof spec !== "object") {
        return { ...safe, aggregates: getAgentAggregates(agent.id, ws), appMaster: null, backbone: null, kpiDeltas: null };
      }

      const latest = getLatestAgentRollupRaw(agent.id, ws);
      const backbone = latest && hasBackboneFields(latest.raw) ? backboneScore(backboneFromRollup(latest.raw)) : null;
      const population = spec.role?.population;
      return {
        ...safe,
        aggregates: getAgentAggregates(agent.id, ws),
        appMaster: {
          population: population === "human" || population === "agent" || population === "either" ? population : "either",
          scopeRung: typeof spec.mandate?.scopeRung === "number" ? spec.mandate.scopeRung : null,
          probationDays: typeof spec.tenure?.probationDays === "number" ? spec.tenure.probationDays : null,
          // Autopilot is a PERSONAS-side fact, so it comes from what the agent
          // reported, never from the spec kp dispatched — a spec saying
          // "probation ⇒ suggest" is an intention; the rollup is the reading.
          autopilotMode: autopilotOf(latest?.raw),
        },
        backbone,
        // The per-objective readings behind the backbone's `objectives` rule.
        // The roster maps the hired objectives onto these, so the expectations
        // column answers "did the value ledger move" for an App master instead
        // of the run/spend proxies it uses for a task agent.
        kpiDeltas: backbone ? backboneFromRollup(latest?.raw).kpiDeltas : null,
      };
    });
    return NextResponse.json({ agents });
  } catch (error) {
    return safeJsonError(error, "api:agents", "AGENT_LIST_FAILED");
  }
}
