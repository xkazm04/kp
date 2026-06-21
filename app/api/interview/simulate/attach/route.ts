import { NextRequest, NextResponse } from "next/server";
import { getInterviewSessionByToken, recordSimTranscriptAttached } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// d95fed6d — attach a practice (simulator) interview to a candidate's record.
// Annotation-only: records a `sim_attached` event on the entry so the practice
// run shows in the drawer history; it does NOT link the session to the entry or
// move anything (the sim's no-pipeline-side-effects contract holds — this is an
// explicit recruiter action, not a sim effect).
//
// A practice run qualifies by having NO linked pipeline entry — real candidate
// sessions are entry-linked by /api/interview/create. The old guard required
// `mode === "test"`, but /api/interview/simulate mints sim sessions as mode
// "candidate" (entryId null) so providers receive the scripted brief — so this
// route 404'd on EVERY simulate-created session and the whole feature was dead.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown; entryId?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
    if (!token || !entryId || entryId.length > 120) {
      return NextResponse.json({ error: "token and entryId are required." }, { status: 400 });
    }
    const session = getInterviewSessionByToken(token);
    // Accept a practice run (no linked entry); reject a real, entry-linked candidate
    // session — it's already on a candidate's record and isn't a sim to annotate.
    if (!session || session.entryId) {
      return NextResponse.json({ error: "Simulation session not found." }, { status: 404 });
    }
    const detail = [session.jobTitle, session.endedAt ? "completed" : session.status].filter(Boolean).join(" · ") || null;
    const ok = recordSimTranscriptAttached(entryId, detail);
    if (!ok) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:interview:simulate:attach", "PIPELINE_ACTION_FAILED");
  }
}
