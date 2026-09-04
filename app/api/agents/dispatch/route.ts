import { NextRequest, NextResponse } from "next/server";
import { createHiredAgent, getActiveHiredAgentForIntake, getActiveHiredAgentForJob, getLatestAgentFitSpec, recordAgentLifecycle, setHiredAgentRequest, updateHiredAgentStatus } from "@/app/_lib/db/agents";
import { getIntake } from "@/app/_lib/db/intakes";
import { getJob } from "@/app/_lib/db/jobs";
import { createPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { appMasterSpecSchema, type AppMasterSpec } from "@/app/_lib/schemas.generated";
import { dispatchPersonaRequest, type DispatchSpec, type KpLink } from "@/app/_lib/agent-hire/bridge-client";

// Agent-candidate bridge — POST dispatches a spec to Personas as a persona
// request. TWO origins, one tail:
//
//   {jobId}    — the shipped path: the job's latest AgentFitSpec (plus the
//                operator's body overrides) becomes the flat DispatchSpec.
//   {intakeId} — App master (P4, docs/features/app-master/README.md): the
//                intake's composed AppMasterSpec is validated, its `agent` block
//                is PROJECTED onto the same flat DispatchSpec, and the whole
//                AppMasterSpec rides beside it as `appMaster` on the wire.
//
// The shared tail is unchanged in order and in failure semantics (pinned by
// agents-bridge.test.ts):
//   1. idempotency: a live agent for the job (or the intake) is returned as-is;
//   2. a hired_agents row is minted (status dispatched, CSPRNG report token);
//   3. the persona request POSTs to Personas; success stamps requestId +
//      pending_approval, failure marks the row failed (the roster shows why);
//   4. only on success does the agent enter the pipeline at Offer (candidateId
//      "agent-<id>", sourceChannel "agent-bridge") — activation later auto-moves
//      it to Hired. A failed dispatch leaves NO card on the board.
//
// Step 4 has one App-master carve-out: a hire composed from an INTAKE has no job
// posting, so there is no board column it belongs in. It is skipped rather than
// faked — see the note at the call site.

// THROTTLE (rate-limit-contract.test.ts). This door mints a row, POSTs a persona
// request to Personas and files a board card — real outbound work with a real
// budget attached — behind `requireOperator()`, which open mode (no
// KP_OPERATOR_PASSWORD) makes a documented no-op for the whole API. 10/10min per
// IP: a human dispatches a handful of agents in a sitting, a script does not.
const DISPATCH_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

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

/** Project an AppMasterSpec onto the flat spec the bridge has always sent.
 *
 *  LOSSLESS BY DESIGN — `AgentBlock` in `pipeline/jobfit/appmaster.py` mirrors
 *  these fields precisely so this is a projection, not a re-derivation. The
 *  budget ceiling is the App-master monthly budget (there is only one budget in
 *  this role contract, and it carries a reservation policy the flat spec has no
 *  room for — which is exactly why `appMaster` also rides the wire). Success
 *  metrics are the objectives: the value ledger IS what this role is measured on. */
function specFromAppMaster(appMaster: AppMasterSpec): DispatchSpec {
  const agent = appMaster.agent;
  const maxTurns = typeof agent?.maxTurns === "number" && Number.isInteger(agent.maxTurns) && agent.maxTurns > 0 ? agent.maxTurns : null;
  return {
    name: (agent?.name || appMaster.role.title || "App master").trim(),
    mission: (agent?.mission ?? "").trim(),
    systemPromptDraft: (agent?.systemPromptDraft ?? "").trim(),
    connectors: (agent?.connectors ?? []).filter((c): c is string => typeof c === "string" && !!c.trim()),
    maxBudgetUsd: Number.isFinite(appMaster.budget.monthlyUsd) ? appMaster.budget.monthlyUsd : null,
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

/** Mint → dispatch → (board) — identical for both origins. */
async function mintAndDispatch(
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
  }
): Promise<NextResponse> {
  // The limiter sits HERE rather than at the top of POST on purpose: every cheap
  // refusal of both origins (unknown job/intake, not composed, spec stale, human
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
  const dispatched = await dispatchPersonaRequest(input.spec, kpLink, agent.reportToken, input.appMaster ?? undefined);
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

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority — and in open mode it proves nothing at all. This door
  // mints a hire, commits a monthly USD budget to it, and files a card on the
  // pipeline board at Offer. That is a recruiter act, so it asks the recruiter
  // capability: `pipeline:write`, which viewers do not hold. NOT org:manage — the
  // hire is hiring work, not installation configuration, and the two doors that
  // ARE installation configuration (pair, bridge) ask for that instead.
  //
  // Ahead of the body parse and of every refusal below, so an unauthorized caller
  // reaches no store read at all; the spend throttle stays where it is, at the
  // point past which the request always costs something.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => null)) as {
      jobId?: unknown;
      intakeId?: unknown;
      overrides?: SpecShape & { budgetUsd?: unknown };
    } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    const intakeId = typeof body?.intakeId === "string" ? body.intakeId : "";
    if (!jobId && !intakeId) {
      return NextResponse.json({ error: "jobId or intakeId is required." }, { status: 400 });
    }
    const ws = await currentWorkspace();

    // ---- App master: dispatch from a composed intake -----------------------
    if (intakeId) {
      const intake = getIntake(intakeId, ws);
      if (!intake) return NextResponse.json({ error: "Intake not found.", code: "AGENT_DISPATCH_INTAKE_NOT_FOUND" }, { status: 404 });
      if (intake.shape !== "app_master") {
        return NextResponse.json({ error: "This is not an App master intake.", code: "AGENT_DISPATCH_NOT_APP_MASTER" }, { status: 400 });
      }
      if (!intake.appMaster) {
        return NextResponse.json(
          {
            error: "No App master spec for this intake yet — compose it first (POST /api/intake/[id]/compose-app-master).",
            code: "AGENT_DISPATCH_NOT_COMPOSED",
          },
          { status: 409 }
        );
      }
      // One live App master per intake — a double-click reuses the in-flight hire.
      const live = getActiveHiredAgentForIntake(intakeId, ws);
      if (live) {
        return NextResponse.json({ hiredAgentId: live.id, requestId: live.requestId, status: live.status, existing: true });
      }

      // The spec crosses a JSON column, and the mandate is the whole point of
      // this role — a half-parsed rung or a dropped forbidden-class list must
      // never reach a dispatch. Validate against the codegen'd contract, refuse
      // out loud otherwise.
      const parsed = appMasterSpecSchema.safeParse(intake.appMaster.spec);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "The stored App master spec no longer matches the contract — re-compose it before dispatching.",
            code: "AGENT_DISPATCH_SPEC_STALE",
          },
          { status: 409 }
        );
      }
      const appMaster = parsed.data;
      // `human` is a refusal, not a fallback: hiring an agent into a role the fit
      // transform judged human-only is exactly the decision this feature exists
      // to make visible. `either` is allowed — the requestor chose.
      if (appMaster.role.population === "human") {
        return NextResponse.json(
          {
            error: "This App master role is composed for a human holder — an agent cannot be dispatched for it.",
            code: "AGENT_DISPATCH_HUMAN_POPULATION",
          },
          { status: 400 }
        );
      }
      if (!appMaster.agent) {
        return NextResponse.json(
          {
            error: "The App master spec carries no agent block — re-compose it with an agent population.",
            code: "AGENT_DISPATCH_NO_AGENT_BLOCK",
          },
          { status: 400 }
        );
      }

      const spec = specFromAppMaster(appMaster);
      return await mintAndDispatch(request, ws, {
        // A promoted App-master intake DOES have a job (the human path built a
        // JD); reuse it so the hire keeps its board card. An unpromoted one has
        // none, and that is the normal case here.
        jobId: intake.jobId ?? "",
        jobTitle: appMaster.role.title || intake.title || "App master",
        intakeId,
        spec,
        fit: intake.appMaster.fit,
        metrics: spec.successMetrics,
        budgetUsd: spec.maxBudgetUsd,
        appMaster,
      });
    }

    // ---- The shipped job path ----------------------------------------------
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

    return await mintAndDispatch(request, ws, {
      jobId,
      jobTitle: job.title,
      spec,
      fit: fitSpec.fit,
      metrics,
      budgetUsd,
    });
  } catch (error) {
    return safeJsonError(error, "api:agents/dispatch", "AGENT_DISPATCH_FAILED");
  }
}
