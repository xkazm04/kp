import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { consentWithholdsPii, redactTranscriptForConsent } from "@/app/_lib/consent";
import { getInterviewSessionInWorkspace } from "@/app/_lib/db/interviews";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";

// GET /api/interview/sessions/[id] → { session } — ONE voice-interview session with
// its transcript and scorecard, by session id. Insights → Activity resolves the
// `interview_realtime` ledger row (whose `request_id` IS the session id) to the
// conversation it paid for through this door. Operator-gated, scoped to the
// caller's workspace (a foreign or unknown id answers 404), consent-redacted like
// the entry-keyed read, and NEVER carries the candidate's bearer token.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const session = getInterviewSessionInWorkspace(id, ws);
    if (!session) return jsonRefusal("INTERVIEW_SESSION_NOT_FOUND", 404);
    const entry = session.entryId ? getPipelineEntry(session.entryId, ws) : null;
    const withheld =
      entry != null &&
      consentWithholdsPii({ givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt });
    const { token: _token, instructions: _instructions, ...wire } = withheld ? redactTranscriptForConsent(session) : session;
    return NextResponse.json({ session: wire });
  } catch (error) {
    return safeJsonError(error, "api:interview:sessions/[id]", "INTERVIEW_LOOKUP_FAILED");
  }
}
