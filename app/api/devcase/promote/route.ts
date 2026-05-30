import { NextRequest, NextResponse } from "next/server";
import { getSubmission } from "@/app/_lib/db";
import { promoteSubmission } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";

// Bridge: an evaluated submission becomes a pipeline entry + a Decisions review card.
// Shares promoteSubmission with the lifecycle orchestrator.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: string };
    if (!body.submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    const sub = getSubmission(body.submissionId);
    if (!sub) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    if (!sub.evaluation) return NextResponse.json({ error: "evaluate the submission first." }, { status: 400 });
    const entryId = promoteSubmission(body.submissionId);
    return NextResponse.json({ ok: true, entryId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Promote failed." }, { status: 500 });
  }
}
