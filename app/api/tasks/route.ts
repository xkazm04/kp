import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { ensureRecovered, isKnownKind, recentTaskCutoffIso, startTask } from "@/app/_lib/tasks";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


// GET: active tasks + those finished within the recent window (the client polls
// this). Older finished tasks are paged in separately via /api/tasks/history so
// this live payload stays bounded. POST: start (idempotent via dedupe_key).
//
// TENANCY: this pair is the single door for every task the UI starts —
// TasksProvider.startTask posts here, so screen waves, group evaluations,
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list tasks." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // THROTTLE (rate-limit-contract.test.ts). This route reaches the SAME startTask
    // that /api/jds/generate gates behind requireOperator and /api/analyze throttles
    // at 30/10min — with neither. proxy.ts admits any valid session, and /api/demo
    // mints an anonymous demo-workspace one (which requireOperator rejects and this
    // route never asked for), so on a password-gated deploy with the demo enabled an
    // anonymous visitor could spend unbounded LLM credit by varying params to defeat
    // the dedupe key. requireOperator is NOT the fix here: it would 401 the guided
    // demo, which legitimately starts batch_screen through this door.
    //
    // 120/10min is deliberately generous: useDecisionsQueue fires one POST per
    // accepted screening review, so a 50-card bulk accept is a legitimate 50-request
    // burst and a tighter budget would silently drop interview-prep artifacts.
    if (!rateLimit(`tasks-start:${clientIpFrom(request.headers)}`, { limit: 120, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { kind?: string; params?: Record<string, unknown> };
    if (!body.kind || !isKnownKind(body.kind)) {
      return NextResponse.json({ error: `unknown task kind: ${body.kind ?? "(none)"}` }, { status: 400 });
    }
    // The tenant comes from the SESSION, never the body — a client-supplied
    // workspace would let any caller run work against another team's data.
    const task = startTask(body.kind, body.params ?? {}, await currentWorkspace());
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start task." }, { status: 500 });
  }
}
