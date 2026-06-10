import { NextResponse } from "next/server";
import { approveLifecycleCase, getLifecycle } from "@/app/_lib/db";
import { recordAudit } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

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
    const body = (await request.json().catch(() => ({}))) as { case?: unknown };
    const edits = coerceCaseEdits(body.case);
    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (lc.stage === "awaiting_approval" || lc.stage === "designed") {
      // Persist the dev case + flip to "approved" atomically (the one shared
      // approve transition), then audit the human decision. The audit row lives on
      // a separate connection (dev-control) so it can't join the DB transaction —
      // record it right after. This used to be the dead orchestrator approveLifecycle's
      // only job; the inline copy here omitted it, so human approvals went unaudited.
      const approvedCase = edits ? { ...((lc.case as Record<string, unknown> | null) ?? {}), ...edits } : lc.case;
      const { caseId } = approveLifecycleCase(
        id,
        { need: lc.need, analysis: lc.analysis, role: lc.role, case: approvedCase },
        edits ? "approved by a human (with reviewer edits)" : "approved by a human"
      );
      recordAudit({
        lifecycleId: id,
        actor: "human",
        action: "approved",
        ref: caseId,
        reason: edits ? `with edits: ${Object.keys(edits).join(", ")}` : undefined,
      });
    }
    const task = startTask("lifecycle", { lifecycleId: id, title: lc.title });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
