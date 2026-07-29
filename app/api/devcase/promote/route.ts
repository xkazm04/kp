import { NextRequest, NextResponse } from "next/server";
import { getSubmission } from "@/app/_lib/db";
import { mintObservedFromSubmission, promoteSubmission } from "@/app/_lib/devcase-run";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";


// Bridge: an evaluated submission becomes a pipeline entry + a Decisions review card.
// Shares promoteSubmission with the lifecycle orchestrator — INCLUDING the calibrated
// floor (case-sim round 2): the manual door must not advise on a different threshold
// than the automated one, or the same submission reads "advance" through one door and
// "hold" through the other. The response carries the verdict + its reasons so the
// caller (and the audit trail) can explain the decision.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: string };
    if (!body.submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    const sub = getSubmission(body.submissionId);
    if (!sub) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    if (!sub.evaluation) return NextResponse.json({ error: "evaluate the submission first." }, { status: 400 });
    const result = promoteSubmission(body.submissionId, activePromoteFloor());
    // Take-home -> observed bridge (best-effort): a promoted submission cleared the
    // transfer floor, so a resolvable candidate profile gains observed-provenance
    // skills. Failures never block the promotion itself.
    let observedSkills: string[] = [];
    if (result) {
      try {
        observedSkills = (await mintObservedFromSubmission(body.submissionId, result.entryId)).credited;
      } catch {
        /* minting is enrichment, not a gate */
      }
    }
    return NextResponse.json({
      ok: true,
      entryId: result?.entryId ?? null,
      recommendation: result?.recommendation ?? null,
      reasons: result?.reasons ?? [],
      observedSkills,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Promote failed." }, { status: 500 });
  }
}
