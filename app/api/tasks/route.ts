import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { ensureRecovered, isKnownKind, recentTaskCutoffIso, startTask } from "@/app/_lib/tasks";


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
