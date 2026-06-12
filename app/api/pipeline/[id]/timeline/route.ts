import { NextResponse } from "next/server";
import { candidateTimeline } from "@/app/_lib/candidate-timeline";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// c6524f2f — the candidate-timeline join for the drawer: analyses, interview,
// invites, offer and comms for one entry, time-ordered. Entry-keyed recruiter
// context, same exposure class as GET /api/pipeline and the drawer's
// /api/pipeline/events?entry= history (full labels; an auth layer is the
// open follow-up tracked in pipeline-events-public.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const items = candidateTimeline(id);
    if (items === null) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    return NextResponse.json({ items });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:timeline", "PIPELINE_TIMELINE_FAILED");
  }
}
