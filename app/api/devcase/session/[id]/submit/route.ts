import { NextResponse } from "next/server";
import { getDevSession, getPostingByToken, submitDevSession } from "@/app/_lib/db/devcase";
import { jsonError, jsonRefusal } from "@/app/_lib/api-response";
import { sessionTokenMatches } from "@/app/_lib/devcase-session-auth";


// Live Work Surface (moonshot E) — finalize a session: resolve the posting from the
// session's token and create the linked submission (idempotent via submitDevSession).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = getDevSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (!session.token) return NextResponse.json({ error: "session has no posting token" }, { status: 400 });
    // UAT M9 — the live-work surface is now the SOLE submit path for workspace
    // cases, so it carries the candidate's identity (name + contact) the repo form
    // used to, keeping a winning evaluation reachable.
    const body = (await request.json().catch(() => ({}))) as { candidate?: unknown; contact?: unknown; token?: unknown };
    // A session id alone is not authority to FINALIZE someone's session: sealing it
    // early would end another candidate's attempt mid-work. Same apply-token re-check
    // as the flush and chat routes (devcase-session-auth.ts).
    if (!sessionTokenMatches(session.token, body.token)) {
      return jsonRefusal("SESSION_TOKEN_REQUIRED", 403);
    }
    const posting = getPostingByToken(session.token);
    if (!posting) return NextResponse.json({ error: "posting not found" }, { status: 404 });
    // bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): the live-session
    // finalize is a SECOND intake path — it must inherit the inbound webhook's honest
    // closed-posting rejection (inbound/route.ts:33) instead of minting a submission on
    // an intake the recruiter has closed. Re-read via the session token and 410 when
    // the posting has closed, matching the public path so the two intakes agree.
    if (posting.status === "closed") {
      // The English here was a hand-copy of REFUSAL_ERRORS.POSTING_CLOSED, on a public
      // candidate surface — so the one sentence existed twice and only one copy was
      // localizable. One producer now, and the client reads the code.
      return jsonRefusal("POSTING_CLOSED", 410);
    }
    const submission = submitDevSession(id, posting.id, {
      candidate: typeof body.candidate === "string" ? body.candidate : null,
      contact: typeof body.contact === "string" ? body.contact : null,
    });
    if (!submission) return NextResponse.json({ error: "could not submit" }, { status: 500 });
    return NextResponse.json({ submissionId: submission.id });
  } catch (error) {
    return jsonError(error, "Failed to submit the work session.");
  }
}
