import { NextRequest } from "next/server";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { letterLanguage, requestInterviewLetter } from "@/app/_lib/interview-letter";
import { startTask } from "@/app/_lib/tasks";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// POST /api/status/[token]/letter — "ask for feedback on my interview", from the
// candidate's own status page (spark interview-feedback-letter, WP-alpha).
//
//   POST body: { lang?: "en" | "cs" | "de" | "fr" }   (the language the page was showing)
//     200 { ok: true, letter: CandidateLetterView }        the request is recorded; the draft is queued
//     409 STATUS_LETTER_ALREADY_REQUESTED + { letter }     one request per application: the existing
//                                                          request's state, never a second letter
//     409 STATUS_LETTER_NOT_ELIGIBLE                       ONE refusal for every reason (no decision
//                                                          yet, an automated screen-out, a closed role,
//                                                          no interview on record, consent withheld)
//     404 STATUS_LINK_INVALID · 413 PAYLOAD_TOO_LARGE · 429 TOO_MANY_REQUESTS
//     500 STATUS_LETTER_REQUEST_FAILED
//
// Public + token-authed like every other /api/status/[token] door — the status link is the
// capability and there is no session — so it sits under the `/api/status/` prefix in
// public-routes.ts and answers CODES, never prose. The tenant comes off the entry the token
// resolves to (getEntryWorkspace), exactly as the status, NPS and recording doors derive it.
//
// What the candidate can learn here is only what the GET projection already tells them
// (`letter.canRequest`): the refusal is one code for every reason, so this door is not a way
// to find out whether a machine screened them out or whether their consent lapsed.
//
// WHAT HAPPENS NEXT, honestly: the request is recorded in the candidate's language and the
// draft is queued; a recruiter reviews, edits and approves or declines it, and the page shows
// the request's state throughout. Nothing drafted here reaches the candidate on its own.

// Tighter than the status read's 60/min: this WRITES, and it starts a model-backed draft.
// A candidate asks once (twice if they double-click), and the second ask is answered from
// the row without queuing anything — so 10/min costs a person nothing and caps a script.
// Keyed per client AND token, like its siblings, so the shared client key an untrusted proxy
// produces still gives each candidate their own bucket.
const LETTER_REQUEST_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/** Hard cap on the body: one optional locale code. Enforced on the BYTES READ, not on the
 *  caller's content-length (request-body.ts). */
const MAX_LETTER_REQUEST_BODY_BYTES = 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Throttle BEFORE the store reads, so a flood never reaches the DB or the task queue.
    if (!rateLimit(`status-letter:${clientIpFrom(request.headers)}:${token}`, LETTER_REQUEST_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entryId = getEntryIdByStatusToken(token);
    if (!entryId) return jsonRefusal("STATUS_LINK_INVALID", 404);
    const workspaceId = getEntryWorkspace(entryId);
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return jsonRefusal("STATUS_LINK_INVALID", 404);

    const body = await readJsonWithLimit<{ lang?: unknown }>(request, MAX_LETTER_REQUEST_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_LETTER_REQUEST_BODY_BYTES });

    // Eligibility, idempotency and the insert are one decision (interview-letter.ts), read
    // off the record — never off anything this body claims.
    const outcome = requestInterviewLetter(entry, workspaceId, letterLanguage(body.lang, entry, workspaceId));
    if (outcome.kind === "not_eligible") return jsonRefusal("STATUS_LETTER_NOT_ELIGIBLE", 409);
    if (outcome.kind === "exists") return jsonRefusal("STATUS_LETTER_ALREADY_REQUESTED", 409, { letter: outcome.view });

    // Queued only for a request that was CREATED, so a repeated click never queues a second
    // draft. Params carry the letter id and the ROLE's title — never the candidate's name:
    // the task row outlives an erasure (ERASURE_EXEMPT["tasks"]).
    try {
      startTask("interview_letter", { letterId: outcome.letter.id, jobTitle: entry.jobTitle ?? "" }, workspaceId);
    } catch (error) {
      // The REQUEST is recorded, and that is what the candidate asked for; a draft that
      // could not be queued leaves the letter `requested`, where the recruiter's queue
      // lists it without a draft (and can draft it again). Answering 500 here would tell
      // the candidate their request failed when it did not — and their retry would meet
      // "already requested". Logged, because an operator should know the queue refused.
      console.error(`[status:letter] draft not queued for letter ${outcome.letter.id}`, error);
    }
    return jsonOk({ ok: true, letter: outcome.view });
  } catch (error) {
    return safeJsonError(error, "api:status:letter", "STATUS_LETTER_REQUEST_FAILED");
  }
}
