import { NextRequest, NextResponse } from "next/server";
import { listLifecycles } from "@/app/_lib/db/devcase";
import { getActiveTaskByDedupe } from "@/app/_lib/db/tasks";
import { getAutonomy, listAudit, recordAudit, setAutonomy } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


const TERMINAL = new Set(["promoted", "closed", "awaiting_approval"]);

// Durability: re-enqueue any non-terminal lifecycle that has no in-flight task (e.g. after a
// restart that orphaned the runner). Idempotent — the lifecycle is stateful + resumable.
//
// TENANT SCOPE (D5): the sweep covers the CALLER'S workspace. It previously called
// listLifecycles() bare, i.e. the default workspace, so a non-default team's orphaned
// lifecycles were unreachable by any operator — scoping it to the caller strictly widens
// who can be recovered while leaving the default tenant's behaviour identical. (The
// autonomy kill-switch and the audit log stay deployment-global: dev_control / dev_audit
// are declared deployment-level tables in the tenancy manifest, not per-team data.)
function reconcile(workspaceId: string): number {
  let resumed = 0;
  for (const lc of listLifecycles(50, workspaceId)) {
    if (TERMINAL.has(lc.stage)) continue;
    if (getActiveTaskByDedupe(`lifecycle:${lc.id}`)) continue;
    startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    resumed += 1;
  }
  return resumed;
}

export async function GET() {
  try {
    const lifecycles = listLifecycles(50, await currentWorkspace());
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
      const resumed = reconcile(await currentWorkspace());
      return NextResponse.json({ autonomy: "on", resumed });
    }
    if (body.action === "reconcile") {
      const resumed = reconcile(await currentWorkspace());
      recordAudit({ actor: "human", action: "reconciled", reason: `resumed ${resumed}` });
      return NextResponse.json({ resumed });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
