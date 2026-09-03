import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { ensureRecovered, isKnownKind, recentTaskCutoffIso, startTask } from "@/app/_lib/tasks";
import { taskBudget, taskBudgetClass } from "@/app/_lib/task-budget";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// The OVERALL door budget, above the per-class one. Deliberately generous:
// useDecisionsQueue fires one POST per accepted screening review, so a 50-card
// bulk accept is a legitimate 50-request burst and a tighter number here would
// silently drop interview-prep artifacts.
const TASKS_START_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

// GET: active tasks + those finished within the recent window (the client polls
// this). Older finished tasks are paged in separately via /api/tasks/history so
// this live payload stays bounded. POST: start (idempotent via dedupe_key).
//
// TENANCY: this pair is the single door for every task the UI starts —
// TasksProvider posts here, so screen waves, group evaluations,
// interview prep, campaign packs, batch outreach and match reasoning all arrive
// through this handler. Both verbs previously omitted the workspace and fell
// through to the store's DEFAULT_WORKSPACE_ID, which broke the feature in both
// directions at once: the tray rendered the DEFAULT tenant's task labels (which
// embed candidate names and role titles) to every team, and every task a
// non-default team started was stamped for the default tenant, so its handler
// then looked its entry up in the wrong team and failed "entry not found" — or,
// worse, succeeded against the wrong cohort and billed a real LLM run for it.
// /api/analyze already did this correctly and is the shape both verbs now copy.
export async function GET() {
  try {
    ensureRecovered(); // self-heal orphaned 'running'/'queued' rows on the first read after a restart/crash
    const ws = await currentWorkspace();
    return NextResponse.json({ tasks: listRecentTasks(recentTaskCutoffIso(), undefined, ws) });
  } catch (error) {
    // better-sqlite3 behind this read: the thrown message carries the absolute db
    // path and SQLite detail, and the dock renders what it is handed.
    return safeJsonError(error, "api:tasks", "TASK_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    // THROTTLE (rate-limit-contract.test.ts). This route reaches the SAME queue
    // that /api/jds/generate gates behind requireOperator and /api/analyze throttles
    // at 30/10min — with neither. proxy.ts admits any valid session, and /api/demo
    // mints an anonymous demo-workspace one (which requireOperator rejects and this
    // route never asked for), so on a password-gated deploy with the demo enabled an
    // anonymous visitor could spend unbounded LLM credit by varying params to defeat
    // the dedupe key. requireOperator is NOT the fix here: it would 401 the guided
    // demo, which legitimately starts batch_screen through this door.
    const ip = clientIpFrom(request.headers);
    if (!rateLimit(`tasks-start:${ip}`, TASKS_START_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const body = (await request.json().catch(() => ({}))) as { kind?: string; params?: Record<string, unknown> };
    if (!body.kind || !isKnownKind(body.kind)) {
      return jsonRefusal("TASK_KIND_UNKNOWN", 400, { kind: body.kind ?? null });
    }
    // The tenant comes from the SESSION, never the body — a client-supplied
    // workspace would let any caller run work against another team's data.
    const ws = await currentWorkspace();
    // …and the SECOND budget, per kind class (app/_lib/task-budget.ts). The 120
    // above was calibrated for the cheapest thing that comes through this door and
    // admitted 120 repo clones, 120 board-wide screen sweeps and 120 cohort
    // evaluations on the same allowance. The per-WORKSPACE half is the one that
    // actually bounds spend: it survives an IP rotation, and with no trusted proxy
    // configured `clientIpFrom` collapses the whole deployment into one bucket
    // anyway, so the IP half alone is the wrong unit for a team.
    const cls = taskBudgetClass(body.kind);
    const budget = taskBudget(body.kind);
    if (!rateLimit(`tasks-start:${cls}:${ip}`, budget.ip)) {
      return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, { budgetClass: cls });
    }
    if (budget.workspace && !rateLimit(`tasks-start-ws:${cls}:${ws}`, budget.workspace)) {
      return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, { budgetClass: cls });
    }
    const task = startTask(body.kind, body.params ?? {}, ws);
    return NextResponse.json({ task });
  } catch (error) {
    // The enqueue writes a row through better-sqlite3 and resolves the session, so
    // the thrown message is store detail, never client copy.
    return safeJsonError(error, "api:tasks", "TASK_START_FAILED");
  }
}
