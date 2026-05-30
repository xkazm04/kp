import { NextResponse } from "next/server";
import { getLifecycle, saveDevCase, updateLifecycle } from "@/app/_lib/db";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// Human gate: approve a lifecycle stuck at awaiting_approval, then resume the automated walk.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (lc.stage === "awaiting_approval" || lc.stage === "designed") {
      const saved = saveDevCase({
        need: lc.need,
        analysis: lc.analysis,
        role: (lc.role as Record<string, unknown>) ?? {},
        case: (lc.case as Record<string, unknown>) ?? {},
      });
      updateLifecycle(id, { stage: "approved", caseId: saved.id, detail: "approved by a human" });
    }
    const task = startTask("lifecycle", { lifecycleId: id, title: lc.title });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
