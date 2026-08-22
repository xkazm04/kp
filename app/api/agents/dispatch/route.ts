import { NextRequest, NextResponse } from "next/server";
import { createHiredAgent, getActiveHiredAgentForJob, getLatestAgentFitSpec, recordAgentLifecycle, setHiredAgentRequest, updateHiredAgentStatus } from "@/app/_lib/db/agents";
import { getJob } from "@/app/_lib/db/jobs";
import { createPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { safeJsonError } from "@/app/_lib/api-response";
import { dispatchPersonaRequest, type DispatchSpec } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — POST {jobId, overrides?} dispatches the job's latest
// AgentFitSpec (incl. the operator's edits, passed as body overrides) to
// Personas as a persona request:
//   1. idempotency: a live agent for the job is returned as-is (409-free reuse);
//   2. a hired_agents row is minted (status dispatched, CSPRNG report token);
//   3. the persona request POSTs to Personas; success stamps requestId +
//      pending_approval, failure marks the row failed (the roster shows why);
//   4. only on success does the agent enter the pipeline at Offer (candidateId
//      "agent-<id>", sourceChannel "agent-bridge") — activation later auto-moves
//      it to Hired. A failed dispatch leaves NO card on the board.

type SpecShape = {
  name?: unknown;
  mission?: unknown;
  systemPromptDraft?: unknown;
  connectors?: unknown;
  maxTurns?: unknown;
};

function mergedSpec(stored: unknown, overrides: SpecShape, budgetUsd: number | null): DispatchSpec {
  const base = (stored ?? {}) as SpecShape;
  const pick = (o: unknown, b: unknown, fallback: string): string =>
    typeof o === "string" && o.trim() ? o.trim() : typeof b === "string" && b.trim() ? b.trim() : fallback;
  const connectors = Array.isArray(overrides.connectors)
    ? overrides.connectors.filter((c): c is string => typeof c === "string" && !!c.trim())
    : Array.isArray(base.connectors)
      ? (base.connectors as unknown[]).filter((c): c is string => typeof c === "string" && !!c.trim())
      : [];
  const rawTurns = overrides.maxTurns !== undefined ? overrides.maxTurns : base.maxTurns;
  const maxTurns =
    typeof rawTurns === "number" && Number.isInteger(rawTurns) && rawTurns > 0 && rawTurns <= 1000 ? rawTurns : null;
  return {
    name: pick(overrides.name, base.name, "Agent"),
    mission: pick(overrides.mission, base.mission, ""),
    systemPromptDraft: pick(overrides.systemPromptDraft, base.systemPromptDraft, ""),
    connectors,
    maxBudgetUsd: budgetUsd,
    ...(maxTurns !== null ? { maxTurns } : {}),
    successMetrics: [],
  };
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as {
      jobId?: unknown;
      overrides?: SpecShape & { budgetUsd?: unknown };
    } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    if (!jobId) return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    const ws = await currentWorkspace();
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    // Dispatch idempotency: one live agent per job — a double-click or a retried
    // fetch reuses the in-flight hire instead of dispatching a second persona.
    const existing = getActiveHiredAgentForJob(jobId, ws);
    if (existing) {
      return NextResponse.json({
        hiredAgentId: existing.id,
        requestId: existing.requestId,
        status: existing.status,
        existing: true,
      });
    }

    const fitSpec = getLatestAgentFitSpec(jobId, ws);
    if (!fitSpec) {
      return NextResponse.json(
        { error: "No agent-fit spec for this job yet — run the transform first (POST /api/jobs/[id]/agent-fit)." },
        { status: 409 }
      );
    }

    const overrides = (body?.overrides ?? {}) as SpecShape & { budgetUsd?: unknown };
    const storedBudget = (fitSpec.budget ?? {}) as { suggestedMonthlyUsd?: unknown };
    // The monthly cap is the one number here that costs money if it is wrong, and
    // the client's own validation (budgetFromInput) is NOT a bound — anything can
    // POST this route. An OMITTED/null budget still falls back to the stored
    // suggestion (buildOverrides drops the key when the field is blank), but a
    // budget that is PRESENT and unusable is refused out loud: silently swapping
    // in the LLM-suggested cap dispatched an agent at a spend limit the operator
    // never asked for and never saw.
    const rawBudget = overrides.budgetUsd;
    const budgetProvided = rawBudget !== undefined && rawBudget !== null;
    if (budgetProvided && !(typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget >= 0)) {
      return NextResponse.json(
        { error: "overrides.budgetUsd must be a non-negative number of USD (omit it to use the suggested budget)." },
        { status: 400 }
      );
    }
    const budgetUsd = budgetProvided
      ? (rawBudget as number)
      : typeof storedBudget.suggestedMonthlyUsd === "number" && Number.isFinite(storedBudget.suggestedMonthlyUsd)
        ? storedBudget.suggestedMonthlyUsd
        : null;
    const spec = mergedSpec(fitSpec.spec, overrides, budgetUsd);
    const metrics = Array.isArray(fitSpec.metrics) ? fitSpec.metrics : [];
    spec.successMetrics = metrics;

    const agent = createHiredAgent(
      { jobId, jobTitle: job.title, spec, fit: fitSpec.fit, metrics, budgetUsd },
      ws
    );

    const kpLink = {
      baseUrl: publicBaseUrl(new URL(request.url).origin),
      jobId,
      jobTitle: job.title,
      workspace: ws,
    };
    const dispatched = await dispatchPersonaRequest(spec, kpLink, agent.reportToken);
    if (!dispatched.ok) {
      updateHiredAgentStatus(agent.id, "failed", {}, ws);
      recordAgentLifecycle(agent.id, { event: "dispatch_failed", reason: dispatched.error }, ws);
      return NextResponse.json(
        { error: `Dispatch to Personas failed: ${dispatched.error}`, hiredAgentId: agent.id },
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
    const { entry } = createPipelineEntry({
      candidateId: `agent-${agent.id}`,
      candidateLabel: spec.name,
      jobId,
      jobTitle: job.title,
      stage: "Offer",
      sourceChannel: "agent-bridge",
      workspaceId: ws,
    });
    recordAutomationEvent(entry.id, "agent_dispatched", `Persona request ${dispatched.requestId} awaiting approval in Personas`, ws);
    return NextResponse.json({ hiredAgentId: agent.id, requestId: dispatched.requestId, status: "pending_approval" });
  } catch (error) {
    return safeJsonError(error, "api:agents/dispatch", "AGENT_DISPATCH_FAILED");
  }
}
