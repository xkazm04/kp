import { NextResponse } from "next/server";
import { getDevSession, getPostingByToken, submitDevSession } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// Live Work Surface (moonshot E) — finalize a session: resolve the posting from the
// session's token and create the linked submission (idempotent via submitDevSession).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = getDevSession(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (!session.token) return NextResponse.json({ error: "session has no posting token" }, { status: 400 });
    const posting = getPostingByToken(session.token);
    if (!posting) return NextResponse.json({ error: "posting not found" }, { status: 404 });
    // UAT M9 — the live-work surface is now the SOLE submit path for workspace
    // cases, so it carries the candidate's identity (name + contact) the repo form
    // used to, keeping a winning evaluation reachable.
    const body = (await request.json().catch(() => ({}))) as { candidate?: unknown; contact?: unknown };
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
