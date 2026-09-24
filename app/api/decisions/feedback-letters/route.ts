import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { feedbackLetterQueue } from "@/app/_lib/interview-letter-review";

// GET /api/decisions/feedback-letters — the recruiter's FEEDBACK-REQUESTS queue (spark
// interview-feedback-letter, WP-beta): every open interview feedback letter in the
// caller's team, oldest request first, each with the candidate's label, the role, the
// decision it follows, when it was asked, its state and the draft (with its source).
//
//   200 { items: FeedbackLetterQueueItem[], truncated: boolean }
//   401 (gated deploy, no operator session) · 500 FEEDBACK_LETTERS_LIST_FAILED
//
// Operator-gated like every /api/decisions/* door: a draft is a letter ABOUT a named,
// decided candidate. Tenant: the caller's own team only — the store binds workspace_id on
// every read, and a letter from another team is simply not in this list. A read, so no
// capability beyond the operator session (the Reconsider queue's posture); the WRITE
// doors under ./[id]/ each ask `pipeline:write`.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json(feedbackLetterQueue(ws));
  } catch (error) {
    return safeJsonError(error, "api:decisions/feedback-letters", "FEEDBACK_LETTERS_LIST_FAILED");
  }
}
