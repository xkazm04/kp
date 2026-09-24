import { NextRequest } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { interviewLetterById, interviewLetterDecline } from "@/app/_lib/db/interview-letters";

// POST /api/decisions/feedback-letters/[id]/decline — a recruiter decides NOT to send
// individual feedback (spark interview-feedback-letter, WP-beta).
//
//   200 { ok: true, letter: { id, state: "declined", decidedAt } }
//   404 FEEDBACK_LETTER_NOT_FOUND · 409 FEEDBACK_LETTER_MOVED + { state }
//   429 TOO_MANY_REQUESTS · 500 FEEDBACK_LETTER_DECLINE_FAILED
//   401 / 403 FORBIDDEN_CAPABILITY (no `pipeline:write`)
//
// SAID TO THE CANDIDATE, never left pending: the letter's state becomes `declined`, and the
// candidate's own status page reads that state and says "the team has decided not to send
// individual feedback" (app/status/[token]/StatusLetterCard.tsx). No email is sent for a
// decline — the candidate asked from their status page, and that is where they were told
// the answer would appear.
//
// Allowed on a letter that can only be closed (consent lapsed, application gone): a
// decline writes who decided and when, and nothing about the candidate. Any draft stays on
// the row as the record of what was declined (the store's contract).

// Same budget as the approve door beside it: one human decision per click.
const DECLINE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  // Closing a candidate's request is a decision about their application: pipeline:write.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await context.params;
    const ws = await currentWorkspace();

    const letter = interviewLetterById(id, ws);
    if (!letter) return jsonRefusal("FEEDBACK_LETTER_NOT_FOUND", 404);
    if ((letter.state !== "requested" && letter.state !== "drafted") || letter.erasedAt) {
      return jsonRefusal("FEEDBACK_LETTER_MOVED", 409, { state: letter.state });
    }

    if (!rateLimit(`feedback-letter-decline:${clientIpFrom(request.headers)}`, DECLINE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The actor is resolved before the write; the store's compare-and-swap re-asserts the
    // open state in the same statement that writes the decision.
    const decidedBy = await humanActor();
    const declined = interviewLetterDecline(id, { decidedBy }, ws);
    if (!declined) {
      return jsonRefusal("FEEDBACK_LETTER_MOVED", 409, { state: interviewLetterById(id, ws)?.state ?? null });
    }
    return jsonOk({ ok: true, letter: { id: declined.id, state: declined.state, decidedAt: declined.decidedAt } });
  } catch (error) {
    return safeJsonError(error, "api:decisions/feedback-letters/decline", "FEEDBACK_LETTER_DECLINE_FAILED");
  }
}
