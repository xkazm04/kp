import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken } from "@/app/_lib/db";
import { receiveSubmission } from "@/app/_lib/distribution";

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
    return NextResponse.json({ ok: true, submission });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Submit failed." }, { status: 500 });
  }
}
