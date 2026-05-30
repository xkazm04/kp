import { NextRequest, NextResponse } from "next/server";
import { getActiveTaskByDedupe, listLifecycles } from "@/app/_lib/db";
import { getAutonomy, listAudit, recordAudit, setAutonomy } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

const TERMINAL = new Set(["promoted", "closed", "awaiting_approval"]);

// Durability: re-enqueue any non-terminal lifecycle that has no in-flight task (e.g. after a
// restart that orphaned the runner). Idempotent — the lifecycle is stateful + resumable.
function reconcile(): number {
  let resumed = 0;
  for (const lc of listLifecycles()) {
    if (TERMINAL.has(lc.stage)) continue;
    if (getActiveTaskByDedupe(`lifecycle:${lc.id}`)) continue;
    startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    resumed += 1;
  }
  return resumed;
}

export async function GET() {
  try {
    const lifecycles = listLifecycles();
    return NextResponse.json({
      autonomy: getAutonomy(),
      lifecycles: lifecycles.map((l) => ({ id: l.id, title: l.title, stage: l.stage, detail: l.detail })),
      pendingGates: lifecycles.filter((l) => l.stage === "awaiting_approval").map((l) => ({ id: l.id, title: l.title, detail: l.detail })),
      audit: listAudit(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === "pause") {
      setAutonomy("paused");
      recordAudit({ actor: "human", action: "paused", reason: "kill switch engaged" });
      return NextResponse.json({ autonomy: "paused" });
    }
    if (body.action === "resume") {
      setAutonomy("on");
      recordAudit({ actor: "human", action: "resumed" });
      const resumed = reconcile();
      return NextResponse.json({ autonomy: "on", resumed });
    }
    if (body.action === "reconcile") {
      const resumed = reconcile();
      recordAudit({ actor: "human", action: "reconciled", reason: `resumed ${resumed}` });
      return NextResponse.json({ resumed });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
