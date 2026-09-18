// What a reconnect after a dropped call continues from (spark ai-interview-parity;
// ADR 0010).
//
// A dropped call used to be a fresh start: the second attempt's interviewer greeted
// the candidate again and re-asked the covered topics, because nothing it was told
// said otherwise. The director's record (interview_events) holds everything a resume
// needs — the earlier attempts' turns, which blocks were begun and covered, and how
// much live time they took — so this reads it and hands /connect a ResumeContext to
// brief the new attempt with.
//
// CALL ORDER: after markInterviewStarted has counted the reconnect (it increments
// `attempts`), so the session's attempts IS the attempt being resumed into and every
// lower attempt is "earlier". Called before the increment, the attempt that just
// dropped would still read as current and its turns would be missing here.

import { listInterviewEvents } from "../db/interview-events";
import { getInterviewSessionInWorkspace } from "../db/interviews";
import { deriveDirectorState } from "./director";
import type { DirectorTurn, ResumeContext } from "./director-types";

/** How many of the earlier attempts' turns a resume carries (the most recent ones). */
export const RESUME_PRIOR_TURNS = 40;

/** Resume context for the attempt a connect is about to open, or null when there is
 *  nothing to resume (a first connect, or no persisted turns from an earlier attempt).
 *  Workspace-scoped like every other read of the session's events. */
export function buildResumeContext(sessionId: string, workspaceId: string): ResumeContext | null {
  const session = getInterviewSessionInWorkspace(sessionId, workspaceId);
  if (!session) return null;
  const attempt = session.attempts;
  const events = listInterviewEvents(sessionId, workspaceId);

  const priorTurnEvents = events
    .filter((e) => e.kind === "turn" && e.attempt < attempt && e.seq !== null)
    .sort((a, b) => a.attempt - b.attempt || (a.seq as number) - (b.seq as number));
  if (priorTurnEvents.length === 0) return null;

  const priorTurns: DirectorTurn[] = priorTurnEvents.slice(-RESUME_PRIOR_TURNS).map((e) => ({
    seq: e.seq as number,
    role: e.payload.role === "candidate" || e.payload.role === "interviewer" ? e.payload.role : "system",
    text: typeof e.payload.text === "string" ? e.payload.text : "",
    at: e.at,
  }));

  // Only the EARLIER attempts' record decides where the conversation stands: the new
  // attempt has not said anything yet. `nowMs` is irrelevant to the prior-attempt
  // arithmetic, so the latest earlier event stands in for it (no clock read needed).
  const earlier = events.filter((e) => e.attempt < attempt);
  const lastAt = earlier.reduce((max, e) => Math.max(max, Date.parse(e.createdAt) || 0), 0);
  const state = deriveDirectorState({
    agenda: session.agenda,
    events: earlier,
    currentAttempt: attempt,
    attemptStartedAtMs: lastAt,
    nowMs: lastAt,
  });

  return {
    attempt,
    priorTurns,
    activeBlockId: state.activeBlockId,
    coveredBlockIds: state.coveredBlockIds,
    elapsedSec: Math.round(state.priorAttemptsMs / 1000),
  };
}
