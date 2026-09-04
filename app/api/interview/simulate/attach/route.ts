import { NextRequest, NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getInterviewSessionByToken } from "@/app/_lib/db/interviews";
import { recordSimTranscriptAttached } from "@/app/_lib/db/pipeline";
import { safeJsonError } from "@/app/_lib/api-response";
import { readEntityId } from "../../entry-id";
import { isAttachableSimSession, simAttachDetail, simRunRef } from "./sim-session";


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
    // Tenant-scoped READ (wave 18b). This is a GATED recruiter action, not a
    // public token surface: the caller has a workspace and it is the authority.
    // Reading the session unscoped meant a token from another team resolved here
    // — the practice run's job title and status then landed, as prose, in a
    // drawer history line on a candidate of the caller's team. Resolved once and
    // reused for the entry write below, so the read and the write cannot disagree
    // about whose tenant this is.
    const workspace = await currentWorkspace();
    const session = getInterviewSessionByToken(token, workspace);
    // bug-ui-scan-2026-07-09 (interview-simulation-comparison #3) — accept ONLY a
    // completed, entry-less, candidate-mode practice run (isAttachableSimSession).
    // The old `session.entryId`-only guard also accepted lab mode:"test" sessions
    // and never-run `created` sessions, stamping a sim_attached event for an
    // interview that was never conducted.
    if (!session || !isAttachableSimSession(session)) {
      return NextResponse.json({ error: "Simulation session not found." }, { status: 404 });
    }
    // Idempotency per (session, entry): the store de-duplicates on this exact
    // string, and simAttachDetail makes it unique per SESSION (see sim-session.ts).
    // A second POST for the same run therefore answers the attachment already on
    // the record — the same `attachRef` back, no second event — instead of on
    // the client-side latch, which no reload or second tab survives; and two
    // DIFFERENT practice runs on one candidate no longer collapse into one line.
    const detail = simAttachDetail(session) || null;
    // Tenancy: the annotation write matches the entry on workspace_id, so the
    // unscoped call looked for the candidate in the DEFAULT team and found nobody —
    // "attach this practice interview to a candidate" answered `entry not found`
    // for EVERY candidate on every other team, killing the feature exactly as the
    // mode:"test" guard above once did. Gated recruiter action, so the caller's own
    // tenant is the authority; the picker's entry ids come from the already-scoped
    // /api/pipeline, so a caller can only ever name one of their own.
    const ok = recordSimTranscriptAttached(entryId, detail, workspace);
    if (!ok) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    // The stable reference of the annotation now on the record. A repeat POST
    // answers the SAME ref having written nothing, so a client can confirm the
    // attachment idempotently rather than inferring it from a bare `ok`.
    return NextResponse.json({ ok: true, attachRef: simRunRef(session.id) });
  } catch (error) {
    return safeJsonError(error, "api:interview:simulate:attach", "PIPELINE_ACTION_FAILED");
  }
}
