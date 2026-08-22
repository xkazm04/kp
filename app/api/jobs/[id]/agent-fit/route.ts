import { NextRequest, NextResponse } from "next/server";
import { getLatestAgentFitSpec } from "@/app/_lib/db/agents";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { startTask } from "@/app/_lib/tasks";
import { safeJsonError } from "@/app/_lib/api-response";

// Agent-candidate bridge — POST starts the BACKGROUNDED job → AgentFitSpec
// transform (task kind `agent_fit`, one LLM call with a keyless deterministic
// fallback); the result persists as the job's latest agent_fit_specs row, which
// GET returns (and which /api/agents/dispatch reads).

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    // Visibility gate (mirrors GET /api/jobs/[id]): getJob is a by-id point read over a
    // globally-unique PK. The spec read below is already workspace-scoped, so this only
    // fixes the existence oracle here — but POST below needs it for real.
    const ws = await currentWorkspace();
    const job = getJob(id);
    if (!job || !jobVisibleToWorkspace(id, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    return NextResponse.json({ spec: getLatestAgentFitSpec(id, ws) });
  } catch (error) {
    return safeJsonError(error, "api:jobs/agent-fit", "AGENT_FIT_FAILED");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // The transform spends an LLM call the moment it's accepted — gate before any
  // work, like /api/jds/generate. Open mode (no KP_OPERATOR_PASSWORD) is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    // Visibility gate BEFORE the task is accepted: the transform spends an LLM call on
    // the role's own text, so unguarded team B could start a paid build over team A's
    // private opening and read A's title back off its own task list. 404, not 403.
    const ws = await currentWorkspace();
    const job = getJob(id);
    if (!job || !jobVisibleToWorkspace(id, ws)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // Dedupe key = the job id (task-dedupe.ts), so a double-click coalesces onto
    // the in-flight run instead of paying twice.
    const task = startTask("agent_fit", { jobId: job.id, jobTitle: job.title }, ws);
    return NextResponse.json({ taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:jobs/agent-fit", "AGENT_FIT_FAILED");
  }
}
