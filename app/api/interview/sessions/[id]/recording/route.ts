import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { interviewRecordingRowForSession } from "@/app/_lib/db/interviews";
import { deleteSessionRecordings } from "@/app/_lib/interview-recording";
import { parseRecordingAttempt } from "@/app/_lib/interview-recording-paths";

// DELETE /api/interview/sessions/[id]/recording[?attempt=N] — the RECRUITER's deletion
// of an interview recording. The fourth door onto the same helper, beside the retention
// sweep, the candidate's own control on /status/<token> and GDPR erasure.
//
// `deleteReason: "recruiter"` has been in the vocabulary since the recording feature
// landed and had nowhere to come from, so every recruiter-side removal had to borrow
// another reason's name. A deletion record that cannot say who asked for it cannot
// answer what was asked of it (director-types.ts, RecordingDeleteReason).
//
// Deletion is IRREVERSIBLE and it is a write, so this door asks the capability question
// rather than only "is an operator present": `pipeline:write`, which a viewer seat does
// not hold. Workspace-scoped like every sibling — a foreign or unknown id answers the
// same 404 the playback door gives, so it is not an existence oracle either.
//
// The helper does the rest and its ORDER IS THE CONTRACT: unlink the file, then stamp
// the row, then append the `recording_deleted` event. It is never called inside a
// transaction, because a rollback cannot put a file back.
//
// `?attempt=N` deletes one recorded attempt; no `attempt` deletes every live one. Both
// are idempotent: a second call finds nothing left and answers `{ deleted: 0 }`.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const row = interviewRecordingRowForSession(id, ws);
    // Null covers all three of "no live audio", "another team's session" and "no such
    // session" — one answer, the same one the playback door gives.
    if (!row) return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);
    const wanted = parseRecordingAttempt(request.nextUrl.searchParams.get("attempt"));
    if (wanted !== null && !row.recordings.some((m) => m.attempt === wanted && !m.deletedAt)) {
      return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);
    }
    const deleted = deleteSessionRecordings(row, "recruiter", wanted === null ? undefined : (m) => m.attempt === wanted);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return safeJsonError(error, "api:interview:sessions/[id]/recording", "INTERVIEW_RECORDING_FAILED");
  }
}
