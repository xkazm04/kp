import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getJob } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { AutomationError, runAutomationTask } from "@/app/_lib/automation-run";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { safeJsonError } from "@/app/_lib/api-response";

// The outreach draft spawns the Claude CLI (automation_cli) — comfortably exceed
// its provider timeout so a slow-but-valid draft isn't killed at 60s (matches the
// analyze/ingest routes).
export const maxDuration = 180;

// Sourcing "Reach out" (idea JOB3): file a sourced / rediscovered candidate into
// the pipeline AND fire a first-touch outreach in one click — closing the
// discover→contact loop that previously meant hunting the candidate down in the
// pipeline tab. Reuses existing, tested machinery end-to-end:
//   - createPipelineEntry is idempotent (a re-add returns the existing entry,
//     created:false), so a double-click / an already-pipelined candidate doesn't
//     spawn a second row.
//   - runAutomationTask("outreach") drafts via the cache-keyed automation_cli and
//     dispatches through the durable Outbox, gated on a per-entry `outreach_sent`
//     marker — so the candidate is contacted at most once (first-contact, not a
//     resend) even across repeat clicks.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });
    const ws = await currentWorkspace();

    const body = (await request.json().catch(() => ({}))) as {
      candidateId?: string;
      candidateLabel?: string;
      archetype?: string | null;
      matchScore?: number | null;
      roleFamily?: string | null;
    };
    if (!body.candidateId) {
      return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    }

    // jobTitle / roleFamily come from the authoritative server-side record (the
    // path's job id), not the client body — same trust posture as the rest of the
    // pipeline writes.
    const { entry, created } = createPipelineEntry({
      candidateId: body.candidateId,
      candidateLabel: body.candidateLabel || body.candidateId,
      archetype: body.archetype ?? null,
      roleFamily: body.roleFamily ?? job.roleFamily ?? null,
      jobId: job.id,
      jobTitle: job.title,
      matchScore: body.matchScore ?? null,
      stage: "Screened",
      // Sourced candidates gave no explicit language choice — infer from the CV
      // languages on their saved profile so the outreach below (and every later
      // comm) speaks their language; NULL falls to the workspace default.
      locale: inferProfileLocale(body.candidateId),
      workspaceId: ws,
    });

    const result = await runAutomationTask(entry.id, "outreach", "", undefined, undefined, ws);
    return NextResponse.json({ entryId: entry.id, created, applied: result.applied });
  } catch (error) {
    // AutomationError carries a client-safe business message + status (e.g. the
    // candidate has no saved profile to draft from → 400); everything else goes
    // through the generic safe responder so raw internals never cross the wire.
    if (error instanceof AutomationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return safeJsonError(error, "api:jobs:candidates:outreach", "OUTREACH_FAILED");
  }
}
