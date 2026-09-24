import { NextRequest } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { interviewLetterById } from "@/app/_lib/db/interview-letters";
import { letterCloseOnly } from "@/app/_lib/interview-letter-review";
import { startTask } from "@/app/_lib/tasks";

// POST /api/decisions/feedback-letters/[id]/redraft — queue a FRESH draft of an open
// interview feedback letter (spark interview-feedback-letter, WP-beta).
//
//   200 { ok: true, taskId }   the `interview_letter` draft task (a running one for this
//                              letter is reused — the task dedupes on the letter id)
//   404 FEEDBACK_LETTER_NOT_FOUND · 409 FEEDBACK_LETTER_MOVED + { state }
//   409 FEEDBACK_LETTER_CONSENT_WITHHELD · 429 TOO_MANY_REQUESTS
//   500 FEEDBACK_LETTER_REDRAFT_FAILED · 401 / 403 FORBIDDEN_CAPABILITY
//
// NO BODY, on purpose. The new draft is written from the interview record alone — the
// same inputs as the first one (interview-letter-run.ts) — so a recruiter's unsaved edits
// are never sent to it, and nothing a client posts can steer what the machine writes about
// the candidate. The editor says so before the click.
//
// The draft lands on the letter through the store's compare-and-swap: if a person approves
// or declines while it is being prepared, the late draft is dropped and the decision stands.

// A redraft spawns the drafting CLI and, with a model configured, a paid call. 20 per 10
// minutes is a generous review session and a firm bound on a loop; the task's own `cheap`
// budget class and its dedupe on the letter id sit behind it.
const REDRAFT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
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
    const entry = getPipelineEntry(letter.entryId, ws);
    const closeOnly = letterCloseOnly(entry);
    if (!entry || closeOnly === "application_gone") return jsonRefusal("FEEDBACK_LETTER_NOT_FOUND", 404);
    // The runner would refuse to store a draft about this person anyway; saying so here
    // spares a spawn that could only end in "nothing saved".
    if (closeOnly === "consent_withheld") return jsonRefusal("FEEDBACK_LETTER_CONSENT_WITHHELD", 409);

    if (!rateLimit(`feedback-letter-redraft:${clientIpFrom(request.headers)}`, REDRAFT_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The letter id and the ROLE's title — never the candidate's name: the task row
    // outlives an erasure (ERASURE_EXEMPT["tasks"]). The same params the candidate's own
    // request door queues with.
    const task = startTask("interview_letter", { letterId: letter.id, jobTitle: entry.jobTitle ?? "" }, ws);
    return jsonOk({ ok: true, taskId: task.id });
  } catch (error) {
    return safeJsonError(error, "api:decisions/feedback-letters/redraft", "FEEDBACK_LETTER_REDRAFT_FAILED");
  }
}
