// The live interview's PRODUCER CHANNEL (spark ai-interview-parity; ADR 0010
// "provider brain + our director").
//   POST /api/interview/director  { token, sessionId, attempt, turns: DirectorTurn[],
//        events: DirectorClientEvent[], tool: { callId, name, args } | null }
//        -> DirectorResponse { ok, ackSeq, toolResult, directive, agenda, endCall, clock }
//        (every shape in app/_lib/voice/director-types.ts)
//
// The candidate's browser posts here during the call: the turns that finalized since
// the last acknowledged seq, the observations only it can make (focus, answer timing),
// and at most one tool call the interviewer model is waiting on. The answer is the
// tool's result, at most one stage direction for the model, and whether the call must
// end. The state behind it lives in interview_events (db/interview-events.ts) and the
// policy in voice/director.ts.
//
// PUBLIC TOKEN ROUTE (public-routes.ts lists it beside /connect and /complete): the
// session token is the credential, the tenant is the SESSION's own workspace — never a
// cookie — and the response is a PROJECTION (ids, the tool result, the directive; no
// competency, no goal, no brief). Every refusal carries a code.
//
// A failed exchange must never stall a call: the browser answers the waiting model
// "continue with the agenda" on any non-2xx, so a director outage costs direction, not
// the interview.

import { NextRequest, NextResponse } from "next/server";
import { getInterviewSessionByToken } from "@/app/_lib/db/interviews";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { isPersistConsentSatisfied } from "@/app/_lib/interview-consent";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import {
  parseDirectorClientEvents,
  parseDirectorTool,
  parseDirectorTurns,
  runDirectorStep,
} from "@/app/_lib/voice/director-step";

/** Hard cap on this public door's request body: a handful of finalized turns (each
 *  clamped to MAX_TURN_TEXT_CHARS), up to 20 observations and one tool call.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_DIRECTOR_BODY_BYTES = 64 * 1024;

// Per-TOKEN (the link is the credential; an abuser rotates IPs, and one candidate's
// call is exactly one token). 240/10min = one exchange every 2.5 s sustained — above
// an honest call's pace (a post per finalized turn and per tool call, plus a slow
// heartbeat), and every request past it writes nothing.
const DIRECTOR_RATE_LIMIT = { limit: 240, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonWithLimit<Record<string, unknown>>(request, MAX_DIRECTOR_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_DIRECTOR_BODY_BYTES });

    const token = typeof body.token === "string" && body.token.length <= 200 ? body.token : null;
    if (!token) return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 400);
    const session = getInterviewSessionByToken(token);
    // The sessionId is REQUIRED and cross-checked: a token names one session, and a
    // request that names another is not a request about this call.
    if (!session || body.sessionId !== session.id) return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 404);

    // Only the LIVE call is directed. The terminal states keep the codes /connect
    // answers them with; everything else — a link never connected, a dropped call
    // awaiting its reconnect, a stale tab of an earlier attempt — is "not live".
    if (session.status === "completed") return jsonRefusal("INTERVIEW_ALREADY_COMPLETED", 409);
    if (session.status === "revoked") return jsonRefusal("INTERVIEW_LINK_INACTIVE", 409);
    if (session.status !== "in_progress") return jsonRefusal("INTERVIEW_NOT_LIVE", 409);
    if (body.attempt !== session.attempts) return jsonRefusal("INTERVIEW_NOT_LIVE", 409);
    // The storage invariant /complete holds, held here too: the candidate's words are
    // persisted only when consent is a fact in the row (interview-consent.ts).
    if (!isPersistConsentSatisfied(session.mode, session.consentAt)) {
      return jsonRefusal("INTERVIEW_CONSENT_REQUIRED", 403);
    }

    // AFTER the free refusals above, BEFORE anything is written.
    if (!rateLimit(`interview-director:${token}`, DIRECTOR_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const response = runDirectorStep({
      session,
      turns: parseDirectorTurns(body.turns),
      events: parseDirectorClientEvents(body.events),
      tool: parseDirectorTool(body.tool),
      nowMs: Date.now(),
    });
    return NextResponse.json(response);
  } catch (error) {
    // Store errors carry the db path and constraint names; the browser only needs to
    // know the exchange failed (and then tells the model to continue).
    return safeJsonError(error, "api:interview:director", "INTERVIEW_DIRECTOR_FAILED");
  }
}
