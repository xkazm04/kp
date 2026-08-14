import { NextRequest, NextResponse } from "next/server";
import { getPosting, getSubmission, recordOutbox } from "@/app/_lib/db/devcase";
import { buildFeedbackBrief } from "@/app/_lib/devcase-feedback";


// d142462d — queue a kind, non-adverse strengths/growth feedback brief for a
// non-promoted candidate, assembled from their already-computed evaluation
// (strengths + concerns + transfer gaps). It lands in the dev outbox as a
// `queued` row — the recruiter sends it; the adverse decision itself stays
// human-gated, so this only turns the work they did into respectful feedback.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { submissionId?: string };
    if (!body.submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    const sub = getSubmission(body.submissionId);
    if (!sub) return NextResponse.json({ error: "submission not found" }, { status: 404 });
    if (!sub.evaluation) return NextResponse.json({ error: "evaluate the submission first." }, { status: 400 });

    const bundle = sub.evaluation as {
      evaluation?: { strengths?: string[]; concerns?: string[] };
      transfer?: { gaps?: string[] };
    };
    const posting = sub.postingId ? getPosting(sub.postingId) : null;
    const brief = await buildFeedbackBrief({
      candidateRef: sub.candidateRef ?? "",
      roleTitle: posting?.roleTitle ?? null,
      strengths: bundle.evaluation?.strengths ?? [],
      concerns: bundle.evaluation?.concerns ?? [],
      gaps: bundle.transfer?.gaps ?? [],
    });

    const entry = recordOutbox({
      recipient: sub.contact ?? sub.candidateRef ?? "candidate",
      subject: brief.subject,
      body: brief.body,
      kind: "feedback",
      channel: posting?.channel ?? "devcase",
      // Queued, not sent: it waits in the outbox for the recruiter to dispatch.
      status: "queued",
      ref: sub.id,
      // `ref` here is a SUBMISSION id, not a pipeline entry id, so recordOutbox's
      // ref-based tenant resolution finds no entry and falls back to this — which
      // was previously omitted, filing the drafted candidate letter (their name and
      // their strengths/gaps) into the DEFAULT team's outbox instead of this one's.
      workspaceId: sub.workspaceId,
    });
    return NextResponse.json({ ok: true, outboxId: entry.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't queue feedback." }, { status: 500 });
  }
}
