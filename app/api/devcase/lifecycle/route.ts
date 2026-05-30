import { NextRequest, NextResponse } from "next/server";
import { createLifecycle, listLifecycles } from "@/app/_lib/db";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// Direction A: start an automated lifecycle from a need, or list active ones.
export async function GET() {
  try {
    return NextResponse.json({ lifecycles: listLifecycles() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { need?: { title?: string } & Record<string, unknown>; auto?: boolean };
    if (!body.need) return NextResponse.json({ error: "need is required." }, { status: 400 });
    const lc = createLifecycle(body.need, body.auto !== false); // default fully-auto
    const task = startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    return NextResponse.json({ lifecycle: lc, task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start lifecycle." }, { status: 500 });
  }
}
