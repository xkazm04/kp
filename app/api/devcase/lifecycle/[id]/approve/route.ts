import { NextResponse } from "next/server";
import { approveLifecycleCase, getLifecycle } from "@/app/_lib/db/devcase";
import { isAtReviewGate } from "@/app/_lib/devcase-orchestrator";
import { recordAudit } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";
import { enforceProbeGate } from "@/app/_lib/devcase-probe-audit";


// W5-4 — the editable subset of the designed case a reviewer may correct at
// the gate without a regenerate: bounded scalars + the task list. Probes and
// rubric stay engine-owned (change those via "Regenerate with note" so the
// decision-space contract isn't hand-broken).
function coerceCaseEdits(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const edits: Record<string, unknown> = {};
  if (typeof o.title === "string" && o.title.trim()) edits.title = o.title.trim().slice(0, 200);
  if (typeof o.brief === "string" && o.brief.trim()) edits.brief = o.brief.trim().slice(0, 8000);
  if (Array.isArray(o.tasks)) {
    const tasks = o.tasks
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 500))
      .slice(0, 20);
    if (tasks.length > 0) edits.tasks = tasks;
  }
  if (typeof o.timeboxHours === "number" && Number.isFinite(o.timeboxHours) && o.timeboxHours > 0 && o.timeboxHours <= 80) {
    edits.timeboxHours = o.timeboxHours;
  }
  return Object.keys(edits).length > 0 ? edits : null;
}

// Human gate: approve a lifecycle stuck at awaiting_approval, then resume the
// automated walk. W5-4: the body may carry reviewer edits to the designed case
// ({ case: { title?, brief?, tasks?, timeboxHours? } }) — the gate's promise
// was review/EDIT/approve, not a blind sign-off.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { case?: unknown; overrideProbeAudit?: unknown };
    const edits = coerceCaseEdits(body.case);
    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (isAtReviewGate(lc.stage)) {
      // Persist the dev case + flip to "approved" atomically (the one shared
      // approve transition), then audit the human decision. The audit row lives on
      // a separate connection (dev-control) so it can't join the DB transaction —
      // record it right after. This used to be the dead orchestrator approveLifecycle's
      // only job; the inline copy here omitted it, so human approvals went unaudited.
      const approvedCase = edits ? { ...((lc.case as Record<string, unknown> | null) ?? {}), ...edits } : lc.case;
      // Quality GATE (idea-bb4f5494): a case whose probes can't tell a strong
      // submission from a naive one yields a transfer score that is noise — candidates
      // promoted off it are chosen at random. The probe-strength audit was advisory (a
      // banner) only; ENFORCE it here via the SHARED guard the manual approve path also
      // calls (bug-ui-scan-2026-07-09), so the "none verdict blocks approval unless the
      // reviewer explicitly overrides, and the override is audited" doctrine lives in one
      // place. A "none" verdict returns a 422; the override note goes into the audit trail.
      const probes = (approvedCase as { coverProbes?: unknown[] } | null)?.coverProbes ?? [];
      const gate = enforceProbeGate(probes as Parameters<typeof enforceProbeGate>[0], body.overrideProbeAudit === true);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error, code: gate.code, verdict: gate.verdict }, { status: gate.status });
      }
      const { caseId } = approveLifecycleCase(
        id,
        { need: lc.need, analysis: lc.analysis, role: lc.role, case: approvedCase },
        edits ? "approved by a human (with reviewer edits)" : "approved by a human"
      );
      const reason =
        [edits ? `with edits: ${Object.keys(edits).join(", ")}` : null, gate.auditReason].filter(Boolean).join("; ") || undefined;
      recordAudit({ lifecycleId: id, actor: "human", action: "approved", ref: caseId, reason });
    } else if (edits) {
      // Not at the review gate (a second tab/reviewer already approved, or a retry
      // landed twice) but this request carried reviewer edits. The approve block
      // above is skipped, so those edits would be silently dropped while we still
      // returned { ok: true } — the reviewer never learns their corrections didn't
      // land and the published case differs from what they think they approved.
      // Mirror the redesign route: 409 with the current stage so the UI can say
      // "already approved elsewhere — reload". (An editless body still resumes.)
      return NextResponse.json(
        { error: `lifecycle is at '${lc.stage}', not awaiting review — your edits were not applied.`, stage: lc.stage },
        { status: 409 }
      );
    }
    // Tenant derived from the lifecycle itself, not the session — this is a by-id
    // route, and the row is the authority on which team the resumed runner belongs to.
    const task = startTask("lifecycle", { lifecycleId: id, title: lc.title }, lc.workspaceId);
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
