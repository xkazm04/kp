import { NextRequest, NextResponse } from "next/server";
import { getPostingByToken, lifecycleByPosting } from "@/app/_lib/db";
import { intakeSubmission } from "@/app/_lib/distribution";
import { startTask } from "@/app/_lib/tasks";

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

    if (isNew) {
      const lc = lifecycleByPosting(postingId);
      if (lc && lc.stage === "collecting") startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
    }

    return NextResponse.json({ ok: true, submissionId: submission.id, duplicate: !isNew, acknowledged: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Intake failed." }, { status: 500 });
  }
}
