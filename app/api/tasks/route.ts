import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import { ensureRecovered, isKnownKind, recentTaskCutoffIso, startTask } from "@/app/_lib/tasks";


// GET: active tasks + those finished within the recent window (the client polls
// this). Older finished tasks are paged in separately via /api/tasks/history so
// this live payload stays bounded. POST: start (idempotent via dedupe_key).
export async function GET() {
  try {
    ensureRecovered(); // self-heal orphaned 'running'/'queued' rows on the first read after a restart/crash
    return NextResponse.json({ tasks: listRecentTasks(recentTaskCutoffIso()) });
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
    const task = startTask(body.kind, body.params ?? {});
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start task." }, { status: 500 });
  }
}
