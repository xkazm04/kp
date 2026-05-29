import { NextRequest, NextResponse } from "next/server";
import { createPipelineEntry, getPosting, getSubmission, recordAutomationEvent, setApproval } from "@/app/_lib/db";

export const runtime = "nodejs";

// Bridge: an evaluated submission becomes a pipeline entry + a Decisions review card.
// The CaseEvaluation maps onto the existing screening_review approval shape so it reuses
// the Decisions UI (advance/reject), closing the loop back into the hiring flow.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: string };
    if (!body.submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    const sub = getSubmission(body.submissionId);
    if (!sub) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    if (!sub.evaluation) return NextResponse.json({ error: "evaluate the submission first." }, { status: 400 });

    const bundle = sub.evaluation as { evaluation?: Record<string, unknown>; transfer?: Record<string, unknown> };
    const evaluation = bundle.evaluation ?? {};
    const transfer = bundle.transfer ?? {};
    const score = sub.transferScore ?? Number(transfer.transferScore ?? 0);
    const posting = sub.postingId ? getPosting(sub.postingId) : null;

    const { entry } = createPipelineEntry({
      candidateId: `ds-${sub.id}`,
      candidateLabel: sub.candidateRef ?? "Candidate",
      archetype: "bau",
      roleFamily: "software_engineering",
      jobId: `dc-${posting?.caseId ?? "case"}`,
      jobTitle: posting?.roleTitle ?? "Dev case",
      matchScore: score,
      stage: "AI-matched",
    });

    // never auto-reject from a promote — a human decides in Decisions
    const recommendation = score >= 70 ? "advance" : "hold";
    setApproval(
      entry.id,
      "screening_review",
      JSON.stringify({
        recommendation,
        confidence: score,
        rationale: `${String(evaluation.summary ?? "")} ${String(transfer.roleFitRationale ?? "")}`.trim() || "Dev-case evaluation.",
        strengths: (evaluation.strengths as string[]) ?? [],
        redFlags: (evaluation.concerns as string[]) ?? [],
      })
    );
    recordAutomationEvent(entry.id, "screening_hold", "promoted from dev case");

    return NextResponse.json({ ok: true, entryId: entry.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Promote failed." }, { status: 500 });
  }
}
