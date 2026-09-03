import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { listLifecycles } from "@/app/_lib/db/devcase";
import { getActiveTaskByDedupe } from "@/app/_lib/db/tasks";
import { getAutonomy, listAudit, recordAudit, setAutonomy } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";
import { enforceTaskBudget } from "@/app/_lib/task-budget";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";


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
//
// TASK BUDGET: the sweep is a FAN-OUT — up to 50 `lifecycle` runs (the agent class:
// a whole dev-case orchestration each) enqueued by one POST, straight past the
// per-class budget POST /api/tasks applies, because it calls the runner directly.
// Each resume draws ONE slot of the same allowance under the same keys
// (app/_lib/task-budget.ts), so recovering an orphan and starting one from the dock
// cost the same, and the sweep STOPS at the bound instead of spending 50 at once.
// A partial sweep is the honest outcome: the lifecycles it did not reach stay
// non-terminal and the next call resumes them, so the caller is told which happened.
function reconcile(workspaceId: string, ip: string): { resumed: number; budgetExhausted: boolean } {
  let resumed = 0;
  for (const lc of listLifecycles(50, workspaceId)) {
    if (TERMINAL.has(lc.stage)) continue;
    // Both halves take the tenant: the dedupe probe has to look in the workspace the
    // sweep is recovering (otherwise it checks the default team and happily spawns a
    // duplicate runner), and the task itself has to run as that team.
    if (getActiveTaskByDedupe(`lifecycle:${lc.id}`, workspaceId)) continue;
    // Budget BEFORE the enqueue, and only for a lifecycle actually being started —
    // a terminal or already-running one must not cost a slot.
    if (enforceTaskBudget("lifecycle", ip, workspaceId)) return { resumed, budgetExhausted: true };
    startTask("lifecycle", { lifecycleId: lc.id, title: lc.title }, workspaceId);
    resumed += 1;
  }
  return { resumed, budgetExhausted: false };
}

export async function GET() {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const lifecycles = listLifecycles(50, await currentWorkspace());
    return NextResponse.json({
      autonomy: getAutonomy(),
      lifecycles: lifecycles.map((l) => ({ id: l.id, title: l.title, stage: l.stage, detail: l.detail })),
      pendingGates: lifecycles.filter((l) => l.stage === "awaiting_approval").map((l) => ({ id: l.id, title: l.title, detail: l.detail })),
      audit: listAudit(),
    });
  } catch (error) {
    // The control room sits on better-sqlite3 AND spawns lifecycle runners, so the
    // thrown message carries SQLITE_* codes, the db path or child stderr.
    return safeJsonError(error, "api:devcase/control", "DEVCASE_CONTROL_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === "pause") {
      setAutonomy("paused");
      recordAudit({ actor: "human", action: "paused", reason: "kill switch engaged" });
      return NextResponse.json({ autonomy: "paused" });
    }
    const ip = clientIpFrom(request.headers);
    if (body.action === "resume") {
      // The kill-switch release itself is free and unconditional — releasing autonomy
      // must never be refused because the RUN budget is spent. Only the sweep it
      // triggers is budgeted, and a truncated sweep is reported, not hidden behind a
      // green `resumed`.
      setAutonomy("on");
      recordAudit({ actor: "human", action: "resumed" });
      const { resumed, budgetExhausted } = reconcile(await currentWorkspace(), ip);
      return NextResponse.json({ autonomy: "on", resumed, budgetExhausted });
    }
    if (body.action === "reconcile") {
      const { resumed, budgetExhausted } = reconcile(await currentWorkspace(), ip);
      // Nothing resumed AND the budget refused the first enqueue: the sweep did not
      // happen at all, so this is a refusal, not a `{ resumed: 0 }` that reads like
      // "nothing needed recovering".
      if (resumed === 0 && budgetExhausted) return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, { budgetClass: "agent" });
      recordAudit({ actor: "human", action: "reconciled", reason: `resumed ${resumed}${budgetExhausted ? " (budget reached)" : ""}` });
      return NextResponse.json({ resumed, budgetExhausted });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return safeJsonError(error, "api:devcase/control", "DEVCASE_CONTROL_FAILED");
  }
}
