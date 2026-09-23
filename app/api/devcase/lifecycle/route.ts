import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { meterGate, recordMeterUsage } from "@/app/_lib/billing";
import { createLifecycle, listLifecycles } from "@/app/_lib/db/devcase";
import { caseIntakeCounts } from "@/app/_lib/db/devcase-case-postings";
import { startTask } from "@/app/_lib/tasks";
import { enforceTaskBudget } from "@/app/_lib/task-budget";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Direction A: start an automated lifecycle from a need, or list active ones.
// TENANT SCOPE (D5): both the list and the create carry the caller's workspace, so a
// team sees (and accretes into) its own lifecycles instead of the default tenant's.
//
// INTAKE COUNTS ON THE ROW (challenge-r09 devcase-lifecycle/A): each lifecycle carries
// `submissionCount` (summed across its case's postings - the stall check's "empty?") and
// `inFlight` (attempts mid-case, counts only - what the close confirm names). The section
// used to borrow the workspace's whole postings fold to derive these two numbers. A row
// with no case yet carries zeros, never an absent key.
export async function GET() {
  try {
    const ws = await currentWorkspace();
    const lifecycles = listLifecycles(50, ws);
    const counts = caseIntakeCounts(lifecycles.flatMap((lc) => (lc.caseId ? [lc.caseId] : [])), ws);
    return NextResponse.json({
      lifecycles: lifecycles.map((lc) => {
        const c = lc.caseId ? counts.get(lc.caseId) : undefined;
        return {
          ...lc,
          submissionCount: c?.submissionCount ?? 0,
          inFlight: c?.inFlight ?? { live: 0, idle: 0, oldestLiveStartedAt: null },
        };
      }),
    });
  } catch (error) {
    return safeJsonError(error, "api:devcase/lifecycle", "DEVCASE_LIFECYCLE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      need?: { title?: string } & Record<string, unknown>;
      auto?: boolean;
      lang?: string;
    };
    if (!body.need) return NextResponse.json({ error: "need is required." }, { status: 400 });
    // Billing hard gate + debit: one lifecycle = one dev-case design pipeline
    // (analyze → role → case). Debited at start; redesigns debit separately.
    // Org attribution (org-plan Phase 3): gate + debit read the caller's tenant.
    const workspace = await currentWorkspace();
    // TASK BUDGET. This door enqueues `lifecycle` — the AGENT class — by calling the
    // runner directly, so POST /api/tasks's per-class budget never saw it and a caller
    // out of agent allowance at the dock could keep spending here. Same helper, same
    // keys (app/_lib/task-budget.ts): one allowance across both doors. Placed after the
    // cheap `need` refusal and BEFORE the meter debit below — a refusal that arrives
    // after `recordMeterUsage` charges the tenant for a run that never started.
    const overBudget = enforceTaskBudget("lifecycle", clientIpFrom(request.headers), workspace);
    if (overBudget) return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, overBudget);
    const quota = meterGate("case_designs", { workspace });
    if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    // Journal source: debited at START, before the lifecycle row (and its id) exists, so
    // the cause is named by kind only — moving the debit after createLifecycle would
    // change which failures are charged.
    recordMeterUsage("case_designs", 1, new Date(), workspace, { kind: "devcase_lifecycle" });
    // DEVP5 — the candidate-facing artifact language. Prefer an explicit body
    // choice (validated), else the recruiter's active locale; persisted on the
    // lifecycle and threaded to the dev-case CLIs by the orchestrator.
    const lang = isLocale(body.lang) ? body.lang : await getServerLocale();
    const lc = createLifecycle(body.need, body.auto !== false, lang, workspace); // default fully-auto
    // The runner task must carry the lifecycle's own tenant, or the row is created
    // for this team and its progress appears in the default team's tray.
    const task = startTask("lifecycle", { lifecycleId: lc.id, title: lc.title }, workspace);
    return NextResponse.json({ lifecycle: lc, task });
  } catch (error) {
    // The POST spawns the lifecycle runner on top of the store, so the thrown message
    // can carry child stderr as well as SQLITE_* detail.
    return safeJsonError(error, "api:devcase/lifecycle", "DEVCASE_LIFECYCLE_START_FAILED");
  }
}
