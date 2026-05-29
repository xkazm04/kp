import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/app/_lib/db";
import { isKnownKind, startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// GET: recent + running tasks (the client polls this). POST: start (idempotent via dedupe_key).
export async function GET() {
  try {
    return NextResponse.json({ tasks: listTasks() });
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
