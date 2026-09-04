import { NextRequest, NextResponse } from "next/server";
import { AutomationError, runAutomationTask, type AutomationRefusal } from "@/app/_lib/automation-run";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError, type RefusalErrorCode } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getServerLocale } from "@/i18n/server";

// One POST spawns a Python child AND spends on the configured model, and the
// outreach task additionally DISPATCHES a letter to a candidate — the same cost
// shape as its sibling /api/jobs/[id]/candidates/outreach, which has been throttled
// since /perfect 2026-09-02 while this door, the one the board's AI-actions grid
// calls, had nothing. Session-gated, and open mode (KP_OPERATOR_PASSWORD unset)
// makes that gate a documented no-op for the whole API, so the limiter is the real
// bound. 20/10min per IP: a recruiter working a shortlist legitimately fires a
// handful of tasks in a sitting, a scripted loop always exceeds it.
const AUTOMATION_TASK_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// This module's own refusals → the coded answer the reader sees in their language.
// Anything WITHOUT a refusal token is an engine failure and takes the STORE path.
const REFUSAL_FOR: Record<AutomationRefusal, RefusalErrorCode> = {
  unknown_task: "AUTOMATION_TASK_UNKNOWN",
  entry_not_found: "AUTOMATION_ENTRY_NOT_FOUND",
  entry_has_no_profile: "AUTOMATION_ENTRY_NO_PROFILE",
};


// Synchronous convenience wrapper. The hardened/background path is /api/tasks
// with kind "automation" (tracked, dedup'd, refresh-safe); both share runAutomationTask.
export async function POST(request: NextRequest, context: { params: Promise<{ task: string }> }) {
  // Defense-in-depth: runs a per-entry automation task (LLM spend + outreach side
  // effects) — operator-only, like the bulk pass route.
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above only
  // proves a trusted session is present — in open mode it is true for everyone —
  // so it is identity, never authority. This write is a recruiter operation: ask
  // the seat for `pipeline:write`, so a viewer is refused with a code instead of
  // silently mutating the board.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  const { task } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { entryId?: string; notes?: string };
    // The cheap validation refusal keeps its semantics AHEAD of the throttle, so a
    // malformed body neither consumes budget nor is masked by a 429.
    if (!body.entryId) return jsonRefusal("AUTOMATION_ENTRY_REQUIRED", 400);
    if (!rateLimit(`automation-task:${clientIpFrom(request.headers)}`, AUTOMATION_TASK_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // On-demand (recruiter-initiated) run: pass the recruiter's UI locale so the
    // recruiter-narrative tasks (screen/prep/scorecard) render in the org language.
    // Background/task-runner paths pass none → runAutomationTask falls back to the
    // workspace default.
    const lang = await getServerLocale();
    const out = await runAutomationTask(body.entryId, task, typeof body.notes === "string" ? body.notes : "", undefined, lang, await currentWorkspace());
    return NextResponse.json(out);
  } catch (error) {
    // A refusal THIS module decided: its message is the information, so it is
    // answered as a code the client resolves in the reader's language.
    if (error instanceof AutomationError && error.refusal) {
      return jsonRefusal(REFUSAL_FOR[error.refusal], error.status);
    }
    // Everything else is the spawned engine failing. Its `.message` is
    // parseStderrError's — a Python traceback, argparse usage text, provider stderr,
    // or the absolute workdir path — and this handler used to forward it whole. The
    // engine's own STATUS is preserved (a user-fixable 400 stays a 400) while the
    // detail goes to the server log.
    const status = error instanceof AutomationError ? error.status : 500;
    return safeJsonError(error, "api:automation/task", "AUTOMATION_TASK_FAILED", status);
  }
}
