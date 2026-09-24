import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { consentWithholdsPii } from "@/app/_lib/consent";
import { getInterviewSessionInWorkspace, interviewRecordingRowForSession } from "@/app/_lib/db/interviews";
import { listInterviewEvents } from "@/app/_lib/db/interview-events";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { buildInterviewEvidence, EVIDENCE_EVENT_LIMIT } from "@/app/_lib/interview-evidence";
import { recordingRetentionDue } from "@/app/_lib/interview-recording";

// GET /api/interview/sessions/[id]/evidence → { evidence } — the director's record of
// ONE voice interview, projected for the recruiter: the agenda with what each block was
// given and whether it was covered, the events (turns tagged with their block, the
// interviewer's tool calls, the browser's observations), the derived coverage state and
// the recording ledger's metadata.
//
// Operator-gated and workspace-scoped EXACTLY like its siblings
// (/api/interview/sessions/[id], /api/interview/by-entry, the playback door): a foreign
// or unknown id answers the same 404, so this door can never be used to learn which
// candidates a neighbouring team interviewed.
//
// CONSENT is re-checked at READ TIME, the same synchronous gate the entry-keyed
// transcript read applies: the moment consent has expired (or the entry is anonymized)
// the verbatim words — turn text, evidence quotes, the candidate's forwarded questions —
// are withheld, and what survives is the structure (a guardrail happened, in this block,
// at this minute). The deferred anonymize sweep is an optimisation, not the control.
//
// NOTHING HERE IS SCORED. The integrity observations are observations: no ranking, no
// aggregate verdict, no field a surface could mistake for one (registry:
// observed-process-is-supporting-not-load-bearing).
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const session = getInterviewSessionInWorkspace(id, ws);
    if (!session) return jsonRefusal("INTERVIEW_SESSION_NOT_FOUND", 404);

    const entry = session.entryId ? getPipelineEntry(session.entryId, ws) : null;
    const withholdVerbatim =
      entry != null &&
      consentWithholdsPii({ givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt });

    // Read one row past the bound so `truncated` is a fact rather than a guess: the
    // projection keeps the most recent EVIDENCE_EVENT_LIMIT and says which it was.
    const events = listInterviewEvents(id, ws, { limit: EVIDENCE_EVENT_LIMIT + 1 });

    // The SAME read-time retention predicate the playback door applies, so the panel
    // never offers a player the audio door would 404. Null means this session holds no
    // live recording at all, in which case retention is moot (every row is deleted).
    const retentionRow = interviewRecordingRowForSession(id, ws);
    const retentionDue = retentionRow != null && recordingRetentionDue(retentionRow);

    const evidence = buildInterviewEvidence({
      session: {
        id: session.id,
        provider: session.provider,
        status: session.status,
        attempts: session.attempts,
        agenda: session.agenda,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        recordings: session.recordings,
      },
      events,
      retentionDue,
      withholdVerbatim,
    });
    return NextResponse.json({ evidence });
  } catch (error) {
    return safeJsonError(error, "api:interview:sessions/[id]/evidence", "INTERVIEW_LOOKUP_FAILED");
  }
}
