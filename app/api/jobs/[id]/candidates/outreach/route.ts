import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getJob } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { AutomationError, runAutomationTask } from "@/app/_lib/automation-run";
import { inferProfileLocale } from "@/app/_lib/comms-locale";
import { candidateOutreachSuppression } from "@/app/_lib/rediscovery-alert-store";
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
      source?: unknown;
    };
    if (!body.candidateId) {
      return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    }

    // d95fed6d — the sourcing channel this reach-out was filed from ("sourcing" for
    // the recruiter/rediscovery surfaces). Bounded + shape-checked at the boundary
    // (a slug-like token, mirroring /api/pipeline); an out-of-shape value is dropped,
    // not 400'd — provenance is an annotation, never worth failing the outreach over.
    const sourceChannel =
      typeof body.source === "string" && /^[a-z0-9_-]{1,40}$/.test(body.source) ? body.source : null;

    // GDPR gate BEFORE we mint anything (bug-ui-scan #1): consult the candidate's
    // EXISTING consent across all their entries. A rediscovery re-contact for a
    // NEW role would otherwise INSERT a fresh entry with blank consent that reads
    // as contactable — re-contacting a person who was anonymized/erased or whose
    // consent lapsed. Suppress here so no entry is minted and no send fires;
    // dispatchOutreach re-checks (defense in depth). Fail-closed inside the gate.
    const suppressed = candidateOutreachSuppression(body.candidateId);
    if (suppressed) {
      return NextResponse.json(
        {
          error:
            suppressed === "anonymized"
              ? "This candidate has been anonymized and can no longer be contacted."
              : "This candidate's data-processing consent has expired — re-consent is required before outreach.",
          suppressed,
        },
        { status: 409 }
      );
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
      // Honest channel attribution (E3): a reach-out-sourced candidate is no longer
      // persisted with a null source_channel — it round-trips to the drawer's "via"
      // line + the board's source facet. Only set on a NEW entry; a re-add returns
      // the existing row untouched (createPipelineEntry never relabels), so a second
      // click can't rewrite an earlier attribution.
      sourceChannel,
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
