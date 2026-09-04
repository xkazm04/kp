import { NextRequest, NextResponse } from "next/server";
import { revokeOpenInterviewSessions } from "@/app/_lib/db/interviews";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { readEntityId } from "../entry-id";


// W6-4 (VOX1) — recruiter-triggered revoke: pull every open interview link for
// an entry (wrong candidate, changed mind, link shared too widely) without
// minting a replacement. /connect refuses revoked sessions; the portal shows a
// friendly closed message.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const entryId = readEntityId(body.entryId);
    if (!entryId) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }
    // Tenant-scoped (direction 1): `entry_id` is globally unique, so the bare
    // revoke let an operator on any team kill another team's live interview
    // credential mid-call by id alone. A foreign entry now revokes nothing and
    // answers `{ ok: true, revoked: 0 }` — the same shape an already-revoked
    // entry gets, which is deliberate: a distinct refusal would confirm which
    // entry ids exist on other tenants.
    const revoked = revokeOpenInterviewSessions(entryId, await currentWorkspace());
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return safeJsonError(error, "api:interview:revoke", "INTERVIEW_CREATE_FAILED");
  }
}
