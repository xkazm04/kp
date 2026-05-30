import { NextRequest, NextResponse } from "next/server";
import { actOnPipelineEntry, type PipelineAction } from "@/app/_lib/db";
import { dispatchRejection } from "@/app/_lib/comms-dispatch";

export const runtime = "nodejs";

const ACTIONS: PipelineAction[] = ["accept", "reject", "approve_event"];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { action?: string; detail?: string };
    const action = body.action as PipelineAction;
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const updated = actOnPipelineEntry(id, action, typeof body.detail === "string" ? body.detail : undefined);
    if (!updated) {
      return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });
    }
    // A human reject is the gate; the candidate hears about it (queued by default).
    if (action === "reject") await dispatchRejection(updated);
    return NextResponse.json({ entry: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
