import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken, lifecycleByPosting } from "@/app/_lib/db";
import { receiveSubmission } from "@/app/_lib/distribution";
import { startTask } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// IN: a candidate submission arrives for a posting (local stub / future webhook target).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      postingId?: string;
      token?: string;
      candidateRef?: string;
      repoRef?: string;
      notes?: string;
    };
    let postingId = body.postingId;
    if (!postingId && body.token) postingId = getPostingByToken(body.token)?.id;
    if (!postingId) return NextResponse.json({ error: "postingId or a valid token is required." }, { status: 400 });
    if (!body.candidateRef || !body.repoRef) {
      return NextResponse.json({ error: "candidateRef and repoRef are required." }, { status: 400 });
    }
    const submission = receiveSubmission({ postingId, candidateRef: body.candidateRef, repoRef: body.repoRef, notes: body.notes });

    // Event trigger: if an automated lifecycle is collecting for this posting, resume it
    // (evaluate the new submission -> rank -> promote). Dedup'd, so concurrent arrivals coalesce.
    const lc = lifecycleByPosting(postingId);
    if (lc && lc.stage === "collecting") {
      startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    }

    return NextResponse.json({ ok: true, submission });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Submit failed." }, { status: 500 });
  }
}
