import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { rateLimit } from "@/app/_lib/rate-limit";
import { attachInterviewScorecard, getInterviewSessionInWorkspace } from "@/app/_lib/db/interviews";
import { interviewScoringState } from "@/app/_lib/interview-scoring-state";
import { finalizeCandidateInterviewScoring, type FinalizeScoringDeps } from "@/app/_lib/interview-scorecard-commit";

const RESCORE_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };

export type RescoreDeps = {
  finalize?: typeof finalizeCandidateInterviewScoring;
  scoringDeps?: FinalizeScoringDeps;
};

// POST /api/interview/sessions/[id]/rescore → re-runs AI scorecard synthesis on a
// completed interview session holding a transcript that failed or dropped scoring.
// Operator-gated, scoped to currentWorkspace, throttled per session ID, guarded
// against already-scored sessions via interviewScoringState and requireUnscored CAS.
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
  deps?: RescoreDeps
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;

  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();
    const session = getInterviewSessionInWorkspace(id, ws);
    if (!session) {
      return jsonRefusal("INTERVIEW_SESSION_NOT_FOUND", 404);
    }

    const state = interviewScoringState({
      mode: session.mode,
      status: session.status,
      hasTranscript: !!(session.transcript && session.transcript.length > 0),
      hasScorecard: !!session.scorecard,
      endedAt: session.endedAt,
    });
    if (state !== "unscored") {
      return jsonRefusal("INTERVIEW_NOT_RESCORABLE", 409);
    }

    if (!rateLimit(`interview-rescore:${id}`, RESCORE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    let initialAttach = true;
    const defaultAttach = (sessionId: string, sc: unknown) => {
      if (initialAttach) {
        initialAttach = false;
        return attachInterviewScorecard(sessionId, sc, { requireUnscored: true });
      }
      return attachInterviewScorecard(sessionId, sc);
    };

    const scoringDeps: FinalizeScoringDeps = {
      ...deps?.scoringDeps,
      attach: deps?.scoringDeps?.attach ?? defaultAttach,
    };

    const finalized = await finalizeCandidateInterviewScoring(session, session.transcript ?? [], scoringDeps);
    if (!finalized.attached) {
      return jsonRefusal("INTERVIEW_NOT_RESCORABLE", 409);
    }

    return NextResponse.json({ ok: true, session: finalized.session, gate: finalized.gate });
  } catch (error) {
    return safeJsonError(error, "api:interview:sessions:[id]:rescore", "INTERVIEW_RESCORE_FAILED");
  }
}
