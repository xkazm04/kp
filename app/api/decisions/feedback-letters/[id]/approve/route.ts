import { NextRequest } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { interviewLetterApprove, interviewLetterById } from "@/app/_lib/db/interview-letters";
import { letterTextProblem } from "@/app/_lib/interview-letter-policy";
import { letterCloseOnly } from "@/app/_lib/interview-letter-review";
import { deliverApprovedLetter } from "@/app/_lib/interview-letter-delivery";
import { LETTER_MAX_CHARS } from "@/app/_lib/interview-letter-types";

// POST /api/decisions/feedback-letters/[id]/approve — a recruiter APPROVES the final
// text of an interview feedback letter and it is sent (spark interview-feedback-letter,
// WP-beta).
//
//   body { finalText: string }   the recruiter's edited text — it becomes the human-owned
//                                final text, verbatim (trimmed at the ends)
//   200 { ok: true, letter: { id, state: "sent", decidedAt }, delivery: LetterDeliveryOutcome }
//   400 FEEDBACK_LETTER_TEXT_EMPTY · 400 FEEDBACK_LETTER_TEXT_TOO_LONG + { maxChars }
//   404 FEEDBACK_LETTER_NOT_FOUND (not in this team, or the application is gone)
//   409 FEEDBACK_LETTER_MOVED + { state }   someone decided it first, or an erasure closed it
//   409 FEEDBACK_LETTER_CONSENT_WITHHELD    the candidate's consent lapsed
//   413 PAYLOAD_TOO_LARGE · 429 TOO_MANY_REQUESTS · 500 FEEDBACK_LETTER_APPROVE_FAILED
//   401 / 403 FORBIDDEN_CAPABILITY (no `pipeline:write`)
//
// THE HUMAN ACTOR is the signed-in person (humanActor(): "human:<Name>", or the role token
// "human:recruiter" on a deployment that cannot name one) — derived from the session,
// never from the body, so nobody can approve in someone else's name. The store refuses
// anything that is not a `human:` actor.
//
// A 200 means the APPROVAL is on the record; `delivery` then says truthfully what the
// email did (sent / queued / failed, and whether the consent gate suppressed it). A send
// that did not go out never turns the approval into a failure — the letter is also on
// the candidate's status page whenever their consent allows.
//
// CONSENT. A letter is not written about a person whose consent is withheld: refused
// before anything is stored, the same line the draft runner holds (interview-letter-run.ts
// re-checks consent before saving a draft). The recruiter can still decline, which closes
// the request without writing anything about the candidate.

// A person approves one letter at a time; 30 per 10 minutes is far above any review
// session and still bounds a loop that would otherwise send a candidate email per call.
// requireOperator() is a documented no-op in open mode, so this is the real bound there.
const APPROVE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/** The body is one letter: LETTER_MAX_CHARS characters, JSON-escaped at worst six bytes
 *  each, plus the envelope. Enforced on the bytes read (request-body.ts). */
const MAX_APPROVE_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  // Approving SENDS an email to a candidate on the team's behalf and closes their request:
  // the same authority as every other pipeline write door.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();

    const body = await readJsonWithLimit<{ finalText?: unknown }>(request, MAX_APPROVE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_APPROVE_BODY_BYTES });
    const finalText = typeof body.finalText === "string" ? body.finalText.trim() : "";
    const problem = letterTextProblem(finalText);
    if (problem === "empty") return jsonRefusal("FEEDBACK_LETTER_TEXT_EMPTY", 400);
    if (problem === "too_long") return jsonRefusal("FEEDBACK_LETTER_TEXT_TOO_LONG", 400, { maxChars: LETTER_MAX_CHARS });

    const letter = interviewLetterById(id, ws);
    if (!letter) return jsonRefusal("FEEDBACK_LETTER_NOT_FOUND", 404);
    if ((letter.state !== "requested" && letter.state !== "drafted") || letter.erasedAt) {
      return jsonRefusal("FEEDBACK_LETTER_MOVED", 409, { state: letter.state });
    }
    const entry = getPipelineEntry(letter.entryId, ws);
    const closeOnly = letterCloseOnly(entry);
    if (!entry || closeOnly === "application_gone") return jsonRefusal("FEEDBACK_LETTER_NOT_FOUND", 404);
    if (closeOnly === "consent_withheld") return jsonRefusal("FEEDBACK_LETTER_CONSENT_WITHHELD", 409);

    // After every cheap refusal above, before the write and the send: a request that was
    // never going to approve anything spends none of the window.
    if (!rateLimit(`feedback-letter-approve:${clientIpFrom(request.headers)}`, APPROVE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // Resolved BEFORE the write: the store's compare-and-swap is one synchronous
    // statement, and nothing is awaited between the state check it re-asserts and the
    // write it makes.
    const decidedBy = await humanActor();
    const approved = interviewLetterApprove(id, { finalText, decidedBy }, ws);
    if (!approved) {
      // Lost the race: another reviewer decided, or an erasure closed the row, since the
      // read above. Nothing was written and nothing was sent.
      return jsonRefusal("FEEDBACK_LETTER_MOVED", 409, { state: interviewLetterById(id, ws)?.state ?? null });
    }
    const delivery = await deliverApprovedLetter(approved, entry, ws);
    return jsonOk({ ok: true, letter: { id: approved.id, state: approved.state, decidedAt: approved.decidedAt }, delivery });
  } catch (error) {
    return safeJsonError(error, "api:decisions/feedback-letters/approve", "FEEDBACK_LETTER_APPROVE_FAILED");
  }
}
