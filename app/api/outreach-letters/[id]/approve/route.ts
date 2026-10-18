import { NextRequest } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { outreachLetterApprove, outreachLetterById } from "@/app/_lib/db/outreach-letters";

// POST /api/outreach-letters/[id]/approve — a person approves ONE revision of a held
// first-contact outreach (comms scope C2). Nothing is sent here: release is its own door
// (./release), so approving and sending stay two deliberate acts.
//
//   body { revision: number }   the revision the reviewer read (GET ../ returns it)
//   200 { ok: true, letter: { id, state: "approved", revision, approvedBy, approvedAt } }
//   404 PIPELINE_ENTRY_NOT_FOUND       not in this team
//   409 PIPELINE_MOVE_CONFLICT + { state, revision }   the letter was redrafted since it
//                                      was read (a stale revision), already approved, or
//                                      erased — or the body named no revision at all, which
//                                      is the same answer: reload, read, approve what you read
//   413 PAYLOAD_TOO_LARGE · 500 OUTREACH_FAILED · 401 / 403 FORBIDDEN_CAPABILITY
//
// THE HUMAN ACTOR is the signed-in person (humanActor()), derived from the session and
// never from the body, so nobody can approve in someone else's name. The store refuses
// anything that is not a `human:` actor. No rate limit of its own: approval writes one row
// and sends nothing — the throttle sits on the door that sends.
const MAX_APPROVE_BODY_BYTES = 1024;

export const POST = withWorkspace(async (ws: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  // Approving a letter to a candidate is a pipeline write, the same authority as every
  // other pipeline write door.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await context.params;
    const body = await readJsonWithLimit<{ revision?: unknown }>(request, MAX_APPROVE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_APPROVE_BODY_BYTES });
    const letter = outreachLetterById(id, ws);
    if (!letter) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    const revision = body.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
      return jsonRefusal("PIPELINE_MOVE_CONFLICT", 409, { state: letter.state, revision: letter.revision });
    }

    // Resolved BEFORE the write: the CAS is one synchronous statement, and nothing is
    // awaited between the revision it re-asserts and the write it makes.
    const approvedBy = await humanActor();
    const approved = outreachLetterApprove(id, { revision, approvedBy }, ws);
    if (!approved) {
      const now = outreachLetterById(id, ws);
      return jsonRefusal("PIPELINE_MOVE_CONFLICT", 409, { state: now?.state ?? null, revision: now?.revision ?? null });
    }
    return jsonOk({
      ok: true,
      letter: {
        id: approved.id,
        state: approved.state,
        revision: approved.revision,
        approvedBy: approved.approvedBy,
        approvedAt: approved.approvedAt,
      },
    });
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters:approve", "OUTREACH_FAILED");
  }
});
