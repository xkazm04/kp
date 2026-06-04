import { NextResponse } from "next/server";
import { approveLifecycleCase, getLifecycle } from "@/app/_lib/db";
import { recordAudit } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// Human gate: approve a lifecycle stuck at awaiting_approval, then resume the automated walk.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (lc.stage === "awaiting_approval" || lc.stage === "designed") {
      // Persist the dev case + flip to "approved" atomically (the one shared
      // approve transition), then audit the human decision. The audit row lives on
      // a separate connection (dev-control) so it can't join the DB transaction —
      // record it right after. This used to be the dead orchestrator approveLifecycle's
      // only job; the inline copy here omitted it, so human approvals went unaudited.
      const { caseId } = approveLifecycleCase(id, lc, "approved by a human");
      recordAudit({ lifecycleId: id, actor: "human", action: "approved", ref: caseId });
    }
    const task = startTask("lifecycle", { lifecycleId: id, title: lc.title });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
