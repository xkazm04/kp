import { NextResponse } from "next/server";
import { candidateDrawerBundle } from "@/app/_lib/candidate-timeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";


// c6524f2f / one-call drawer — the WHOLE CandidateDrawer payload for one entry in
// a single request: the cross-store timeline items (analyses, interview, invites,
// offer), the pipeline events, the full comms letters, the latest interview
// outcome and the human scorecard. The drawer used to fire FIVE independent
// fetches on open; this collapses them to one round trip. Entry-keyed recruiter
// context, same exposure class as GET /api/pipeline and the drawer's prior
// per-entry reads (full labels; consent-gated interview synthesis; an auth layer
// is the open follow-up tracked in pipeline-events-public.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const bundle = candidateDrawerBundle(id, await currentWorkspace());
    if (bundle === null) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    // `items` retained at the top level for back-compat with any reader of the
    // prior shape; the enriched fields ride alongside.
    return NextResponse.json({ ...bundle });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:timeline", "PIPELINE_TIMELINE_FAILED");
  }
}
