import { NextRequest, NextResponse } from "next/server";
import { createHiredAgent, recordAgentLifecycle, setHiredAgentRequest, updateHiredAgentStatus } from "@/app/_lib/db/agents";
import { createPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { type AppMasterSpec } from "@/app/_lib/schemas.generated";
import {
  dispatchPersonaRequest,
  type DispatchPassthrough,
  type DispatchSpec,
  type KpLink,
} from "@/app/_lib/agent-hire/bridge-client";
import { boundedBudget, boundedTurns } from "./spec-bounds";

// The shared tail of every hire dispatch: mint the hired_agents row, POST the
// persona request to Personas, file the board card. Extracted from route.ts so
// the one-call door (../hire-from-need) runs the SAME code rather than a second
// copy that drifts — the failure semantics below are pinned by
// agents-bridge.test.ts and there must be exactly one implementation of them.

// THROTTLE (rate-limit-contract.test.ts). This door mints a row, POSTs a persona
// request to Personas and files a board card — real outbound work with a real
// budget attached — behind `requireOperator()`, which open mode (no
// KP_OPERATOR_PASSWORD) makes a documented no-op for the whole API. 10/10min per
// IP: a human dispatches a handful of agents in a sitting, a script does not.
export const DISPATCH_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

/** Project an AppMasterSpec onto the flat spec the bridge has always sent.
 *
 *  LOSSLESS BY DESIGN — `AgentBlock` in `pipeline/jobfit/appmaster.py` mirrors
 *  these fields precisely so this is a projection, not a re-derivation. The
 *  budget ceiling is the App-master monthly budget (there is only one budget in
 *  this role contract, and it carries a reservation policy the flat spec has no
 *  room for — which is exactly why `appMaster` also rides the wire). Success
 *  metrics are the objectives: the value ledger IS what this role is measured on. */
export function specFromAppMaster(appMaster: AppMasterSpec): DispatchSpec {
  const agent = appMaster.agent;
  const maxTurns = boundedTurns(agent?.maxTurns);
  return {
    name: (agent?.name || appMaster.role.title || "App master").trim(),
    mission: (agent?.mission ?? "").trim(),
    systemPromptDraft: (agent?.systemPromptDraft ?? "").trim(),
    connectors: (agent?.connectors ?? []).filter((c): c is string => typeof c === "string" && !!c.trim()),
    maxBudgetUsd: boundedBudget(appMaster.budget.monthlyUsd),
    ...(maxTurns !== null ? { maxTurns } : {}),
    successMetrics: appMaster.objectives.map((o) => ({
      key: o.kpiKey,
      label: o.label || o.kpiKey,
      baseline: o.baseline ?? null,
      target: o.target ?? null,
      unit: o.unit,
      direction: o.direction,
      windowDays: o.windowDays,
    })),
  };
}

/** Mint → dispatch → (board) — identical for every origin. */
export async function mintAndDispatch(
  request: NextRequest,
  ws: string,
  input: {
    jobId: string;
    jobTitle: string;
    intakeId?: string | null;
    spec: DispatchSpec;
    fit: unknown;
    metrics: unknown[];
    budgetUsd: number | null;
    appMaster?: AppMasterSpec | null;
    /** Extra keys for Personas (simulation, origin persona). Absent for a
     *  human-driven dispatch, which is what every caller before the
     *  hire-from-need door was. */
    passthrough?: DispatchPassthrough;
  }
): Promise<NextResponse> {
  // The limiter sits HERE rather than at the top of POST on purpose: every cheap
  // refusal of every origin (unknown job/intake, not composed, spec stale, human
  // population, no agent block, invalid budget) and the one-live-agent idempotency
  // reuse answer BEFORE this function is entered, so a rejected or idempotent call
  // spends no budget. Past this line the request always costs something.
  if (!rateLimit(`agent-dispatch:${clientIpFrom(request.headers)}`, DISPATCH_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const agent = createHiredAgent(
    {
      jobId: input.jobId,
      jobTitle: input.jobTitle,
      intakeId: input.intakeId ?? null,
      appMaster: input.appMaster ?? null,
      spec: input.spec,
      fit: input.fit,
      metrics: input.metrics,
      budgetUsd: input.budgetUsd,
    },
    ws
  );

  const kpLink: KpLink = {
    baseUrl: publicBaseUrl(new URL(request.url).origin),
    jobId: input.jobId,
    jobTitle: input.jobTitle,
    workspace: ws,
    ...(input.intakeId ? { intakeId: input.intakeId } : {}),
  };
  const dispatched = await dispatchPersonaRequest(
    input.spec,
    kpLink,
    agent.reportToken,
    input.appMaster ?? undefined,
    input.passthrough
  );
  if (!dispatched.ok) {
    updateHiredAgentStatus(agent.id, "failed", {}, ws);
    recordAgentLifecycle(agent.id, { event: "dispatch_failed", reason: dispatched.error }, ws);
    // The status stays 502 (the house convention for "the bridge did not carry
    // this"), but a DEAD PAIRING KEY gets its own code: an expired headless
    // auto-pair key (they live 24h) is an operator action — re-pair — not an
    // outage, and `AGENT_DISPATCH_BRIDGE_FAILED` reads like the latter.
    return NextResponse.json(
      {
        error: `Dispatch to Personas failed: ${dispatched.error}`,
        code: dispatched.code ?? "AGENT_DISPATCH_BRIDGE_FAILED",
        hiredAgentId: agent.id,
      },
      { status: 502 }
    );
  }
  setHiredAgentRequest(agent.id, dispatched.requestId, ws);
  recordAgentLifecycle(agent.id, { event: "dispatched", reason: `Personas request ${dispatched.requestId}` }, ws);

  // The agent enters the pipeline at Offer alongside human candidates for this
  // job. Idempotent per (candidate, job) via the m-<candidate>-<job> id scheme.
  // Created only AFTER Personas accepted the request: a failed dispatch mints a
  // fresh agent id each retry, so filing the board entry up front left one
  // phantom Offer-stage card per attempt — and an UNPAIRED kp (the default)
  // fails every dispatch before a single byte leaves the process.
  //
  // An App-master hire dispatched from an intake has NO job posting, so there is
  // no pipeline the card would belong to. The write is skipped, not faked with a
  // synthetic job: a card in a column for a role nobody is hiring for is a lie
  // the board would then carry forever. The roster is that hire's home.
  if (input.jobId) {
    const { entry } = createPipelineEntry({
      candidateId: `agent-${agent.id}`,
      candidateLabel: input.spec.name,
      jobId: input.jobId,
      jobTitle: input.jobTitle,
      stage: "Offer",
      sourceChannel: "agent-bridge",
      workspaceId: ws,
    });
    recordAutomationEvent(entry.id, "agent_dispatched", `Persona request ${dispatched.requestId} awaiting approval in Personas`, ws);
  }
  return NextResponse.json({ hiredAgentId: agent.id, requestId: dispatched.requestId, status: "pending_approval" });
}
