import { NextRequest } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { releaseOutreachLetter } from "@/app/_lib/outreach-release";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/outreach-letters/[id]/release — send an APPROVED first-contact outreach
// (comms scope C2). The only door that sends one: the outreach doors only draft.
//
//   200 { ok: true, letter: { id, state, messageId, approvedBy, releasedAt }, delivery }
//       delivery: "sent" (a relay took it) · "queued" (keyless: the local outbox is the
//       destination) · "failed" (the relay dead-lettered it; state delivery_failed, and a
//       retry re-sends the same message id)
//   404 OUTREACH_LETTER_NOT_FOUND       not in this team, or the application is gone
//   409 OUTREACH_LETTER_CONFLICT + { state }   not approved, already released, or erased
//   409 COMMS_SUPPRESSED + { suppressed }    consent, erasure or a halted sequence
//   422 OUTREACH_BODY_TOO_LONG · 429 TOO_MANY_REQUESTS · 500 OUTREACH_FAILED
//   401 / 403 FORBIDDEN_CAPABILITY
//
// The consent and halt gates run inside releaseOutreachLetter, on the send path's own
// predicates, so this door cannot drift from them.
export const POST = withWorkspace(async (ws: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  // Releasing SENDS an email to a candidate on the team's behalf.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  // Per-IP, AFTER the session and capability refusals (a caller who may not send spends
  // no budget) and BEFORE releaseOutreachLetter, the call that emails a candidate. 60/10min
  // matches the drafting sibling (jobs/[id]/candidates/outreach): a recruiter releases
  // letters one click at a time, a scripted loop cannot mail the whole pool.
  if (!rateLimit(`outreach-release:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await context.params;
    const out = await releaseOutreachLetter(id, ws, await humanActor());
    if (!out.ok) {
      // releaseOutreachLetter speaks the pipeline vocabulary; this door answers in the letter's own.
      const code =
        out.code === "PIPELINE_ENTRY_NOT_FOUND" ? "OUTREACH_LETTER_NOT_FOUND"
        : out.code === "PIPELINE_MOVE_CONFLICT" ? "OUTREACH_LETTER_CONFLICT"
        : out.code;
      return jsonRefusal(code, out.status, out.extra);
    }
    return jsonOk({
      ok: true,
      letter: {
        id: out.letter.id,
        state: out.letter.state,
        messageId: out.letter.messageId,
        approvedBy: out.letter.approvedBy,
        releasedAt: out.letter.releasedAt,
      },
      delivery: out.delivery,
    });
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters:release", "OUTREACH_FAILED");
  }
});
