import { NextResponse } from "next/server";
import { candidateDrawerBundle } from "@/app/_lib/candidate-timeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";


// c6524f2f / one-call drawer — the WHOLE CandidateDrawer payload for one entry in
// a single request: the cross-store timeline items (analyses, interview, invites,
// offer), the pipeline events, the full comms letters, the latest interview
// outcome and the human scorecard. The drawer used to fire FIVE independent
// fetches on open; this collapses them to one round trip. Entry-keyed recruiter
// context, same exposure class as GET /api/pipeline and the drawer's prior
// per-entry reads (full labels; consent-gated interview synthesis).
//
// AUTH (single-entry-authz-parity): the prior in-file "auth is the open follow-up"
// TODO is now closed — this bundle exposes full labels, the candidate's comms
// letters and the human scorecard, the same recruiter PII class the sibling
// /api/pipeline/[id] GET/POST gate. requireOperator runs first: open mode (no
// KP_OPERATOR_PASSWORD) is a no-op (local dev + the guided sim unaffected), a valid
// operator session passes, and the anonymous demo-workspace session is refused (401).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
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
