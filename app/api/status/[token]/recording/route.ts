import { NextRequest } from "next/server";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { deleteEntryRecordings } from "@/app/_lib/interview-recording";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// DELETE /api/status/[token]/recording — "delete my interview recording", from the
// candidate's own status page (spark ai-interview-parity, WP3).
//
// A candidate who agreed to be recorded must be able to change their mind without
// writing to anyone, and without invoking the heavier Art. 17 erasure that also removes
// their application. This door deletes the AUDIO and nothing else: the transcript, the
// scorecard and the application stand, which is what the consent copy promises.
//
// Public + token-authed like every other /api/status/[token] door — the status link is
// the capability, there is no session — so it is listed under the `/api/status/` prefix
// in public-routes.ts and answers CODES, never prose.
//
// IDEMPOTENT BY DESIGN. A candidate who clicks twice, or who never had a recording,
// gets `{ ok: true, deleted: 0 }`. A 404 for "nothing to delete" would turn this into
// an oracle for which candidates were recorded, and it would read to the candidate as
// though their request had failed.

// Tighter than the status read's 60/min: this WRITES and it is irreversible. A candidate
// makes this decision once (twice if they mis-click), so a low cap costs nothing real.
// Keyed per token AND client for the same reason its siblings are — with no trusted
// proxy configured every caller shares one client key, so an IP-only bucket would let
// one reader spend every other candidate's budget.
const RECORDING_DELETE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function DELETE(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Ahead of the store lookup, so a flood never reaches the DB — the shape the
    // /data and /stop doors established for an irreversible public write.
    if (!rateLimit(`status-recording-delete:${clientIpFrom(request.headers)}:${token}`, RECORDING_DELETE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entryId = getEntryIdByStatusToken(token);
    if (!entryId) return jsonRefusal("STATUS_LINK_INVALID", 404);
    // Tenant from the ENTRY (token-driven flow, no session), exactly as the sibling
    // status and NPS doors do — without it a non-default team's candidate would be
    // deleting nothing while being told it worked.
    const workspaceId = getEntryWorkspace(entryId);
    if (!getPipelineEntry(entryId, workspaceId)) return jsonRefusal("STATUS_LINK_INVALID", 404);

    const deleted = deleteEntryRecordings(entryId, workspaceId, "candidate_request");
    return jsonOk({ ok: true, deleted });
  } catch (error) {
    return safeJsonError(error, "api:status:recording", "STATUS_RECORDING_DELETE_FAILED");
  }
}
