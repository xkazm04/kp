import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken } from "@/app/_lib/db";
import { intakeSubmission, PostingClosedError } from "@/app/_lib/distribution";
import { resumeCollectingLifecycle } from "@/app/_lib/tasks";

export const runtime = "nodejs";

// Direction B — the public application webhook. An external channel (job board / ATS / an
// apply form) POSTs a candidate's application here using the posting's apply token; we
// record it, acknowledge the candidate, and — if a lifecycle is collecting — resume it
// automatically (evaluate → rank → promote). This removes the manual submission step.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      candidate?: string;
      repoRef?: string;
      contact?: string;
      notes?: string;
    };
    // PUBLIC webhook: the apply token is the ONLY accepted credential. We deliberately do
    // NOT accept a `postingId` shortcut here — posting ids are internal, non-crypto keys
    // (random-id.ts, "Never a security boundary") so accepting one would let an
    // unauthenticated caller guess/enumerate ids and inject submissions into any posting,
    // bypassing the bearer token entirely. The token is a 128-bit CSPRNG value
    // (distribution.ts) that resolves to exactly one existing posting. The authenticated
    // internal path that takes a postingId directly is /api/devcase/submit.
    const token = request.nextUrl.searchParams.get("token") || body.token;
    const posting = token ? getPostingByToken(token) : undefined;
    if (!posting) return NextResponse.json({ error: "a valid apply token is required." }, { status: 401 });
    // W5-3 — a closed posting answers honestly instead of acknowledging a
    // submission nobody will process ("queued, never ghosts" cuts both ways:
    // a false ack IS a ghost with extra steps).
    if (posting.status === "closed") {
      return NextResponse.json(
        { error: "This role's intake has closed and is no longer accepting submissions." },
        { status: 410 }
      );
    }
    const postingId = posting.id;
    if (!body.candidate || !body.repoRef) {
      return NextResponse.json({ error: "candidate and repoRef are required." }, { status: 400 });
    }

    const { submission, isNew } = await intakeSubmission({
      postingId,
      candidateRef: body.candidate,
      repoRef: body.repoRef,
      contact: body.contact,
      notes: body.notes,
    });

    if (isNew) resumeCollectingLifecycle(postingId);

    return NextResponse.json({ ok: true, submissionId: submission.id, duplicate: !isNew, acknowledged: true });
  } catch (error) {
    // Defensive: the pre-check above already 410s a closed posting, but the shared
    // core also guards (e.g. if the posting closes mid-request) — map it to 410 too.
    if (error instanceof PostingClosedError) {
      return NextResponse.json({ error: error.message }, { status: 410 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Intake failed." }, { status: 500 });
  }
}
