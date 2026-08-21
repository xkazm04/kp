import { NextRequest, NextResponse } from "next/server";
import { getPosting, getPostingByToken } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { intakeSubmission, PostingClosedError } from "@/app/_lib/distribution";
import { jsonRefusal } from "@/app/_lib/api-response";
import { resumeCollectingLifecycle } from "@/app/_lib/tasks";


// IN: a candidate submission arrives for a posting (local stub / future webhook target).
//
// This is the AUTHENTICATED internal door — the one /api/devcase/inbound points at when it
// explains why IT refuses a raw `postingId` (ids are non-crypto internal keys, never a
// security boundary). Being operator-gated is not the same as being tenant-scoped, so the
// posting is resolved and OWNERSHIP-checked below, like /publish, /source, /promote and
// /feedback. Unscoped, a recruiter in one team could post a `postingId` belonging to
// another and intakeSubmission would file the row under the POSTING's workspace: an
// invented candidate appearing on that team's board, plus an acknowledgement mailed from
// their outbox to a caller-supplied address. The token branch is checked the same way —
// the public token-only door is /api/devcase/inbound, which needs no session at all.
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
    if (!body.postingId && !body.token) {
      return NextResponse.json({ error: "postingId or a valid token is required." }, { status: 400 });
    }
    const posting = body.postingId
      ? getPosting(body.postingId)
      : body.token
        ? getPostingByToken(body.token)
        : null;
    if (!posting || posting.workspaceId !== (await currentWorkspace())) {
      // Same body a genuinely unknown posting gets — never an existence oracle for
      // another team's postings.
      return NextResponse.json({ error: "postingId or a valid token is required." }, { status: 404 });
    }
    const postingId = posting.id;
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
    if (error instanceof PostingClosedError) {
      return jsonRefusal("POSTING_CLOSED", 410);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Submit failed." }, { status: 500 });
  }
}
