import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getInterviewSessionByToken } from "@/app/_lib/db/interviews";
import { recordSimTranscriptAttached } from "@/app/_lib/db/pipeline";
import { safeJsonError } from "@/app/_lib/api-response";
import { readEntityId } from "../../entry-id";
import { isAttachableSimSession } from "./sim-session";


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
    const entryId = readEntityId(body.entryId);
    if (!token || !entryId) {
      return NextResponse.json({ error: "token and entryId are required." }, { status: 400 });
    }
    const session = getInterviewSessionByToken(token);
    // bug-ui-scan-2026-07-09 (interview-simulation-comparison #3) — accept ONLY a
    // completed, entry-less, candidate-mode practice run (isAttachableSimSession).
    // The old `session.entryId`-only guard also accepted lab mode:"test" sessions
    // and never-run `created` sessions, stamping a sim_attached event for an
    // interview that was never conducted.
    if (!session || !isAttachableSimSession(session)) {
      return NextResponse.json({ error: "Simulation session not found." }, { status: 404 });
    }
    const detail = [session.jobTitle, session.endedAt ? "completed" : session.status].filter(Boolean).join(" · ") || null;
    // Tenancy: the annotation write matches the entry on workspace_id, so the
    // unscoped call looked for the candidate in the DEFAULT team and found nobody —
    // "attach this practice interview to a candidate" answered `entry not found`
    // for EVERY candidate on every other team, killing the feature exactly as the
    // mode:"test" guard above once did. Gated recruiter action, so the caller's own
    // tenant is the authority; the picker's entry ids come from the already-scoped
    // /api/pipeline, so a caller can only ever name one of their own.
    const ok = recordSimTranscriptAttached(entryId, detail, await currentWorkspace());
    if (!ok) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:interview:simulate:attach", "PIPELINE_ACTION_FAILED");
  }
}
