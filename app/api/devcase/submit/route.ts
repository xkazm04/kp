import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken } from "@/app/_lib/db";
import { intakeSubmission } from "@/app/_lib/distribution";
import { resumeCollectingLifecycle } from "@/app/_lib/tasks";

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
      contact?: string;
    };
    let postingId = body.postingId;
    if (!postingId && body.token) postingId = getPostingByToken(body.token)?.id;
    if (!postingId) return NextResponse.json({ error: "postingId or a valid token is required." }, { status: 400 });
    if (!body.candidateRef || !body.repoRef) {
      return NextResponse.json({ error: "candidateRef and repoRef are required." }, { status: 400 });
    }
    const { submission, isNew } = await intakeSubmission({
      postingId,
      candidateRef: body.candidateRef,
      repoRef: body.repoRef,
      notes: body.notes,
      contact: body.contact,
    });

    // Event trigger: if an automated lifecycle is collecting for this posting, resume it.
    if (isNew) resumeCollectingLifecycle(postingId);

    return NextResponse.json({ ok: true, submission });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Submit failed." }, { status: 500 });
  }
}
