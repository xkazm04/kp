import { NextRequest, NextResponse } from "next/server";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { roleOf } from "@/app/_lib/pipeline-stages";
import { candidateStatusFor, isTerminalCandidateStatus } from "@/app/_lib/application-status";
import { parseNpsSubmission } from "@/app/_lib/candidate-nps";
import { candidateNpsFor, recordCandidateNps } from "@/app/_lib/candidate-nps-store";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// W0.6b — candidate NPS capture on the public, token-gated status page.
//
//   GET  -> { asked: boolean, answered: { score, comment } | null }
//   POST -> { ok: true }   body: { score: 0..10, comment?: string }
//
// Tighter than the status route's 60/min: this WRITES, and a candidate legitimately
// submits once (twice if they change their mind), so a low cap costs nothing real.
const NPS_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

/** Resolve the token to an entry, and decide whether asking is even appropriate.
 *  Carries the entry's WORKSPACE out with it: this is a token-driven flow with no
 *  session, so the tenant is derived from the entry (same rule as the sibling
 *  /decisions route). Without it the read fell through to DEFAULT_WORKSPACE_ID —
 *  a non-default team's candidate got a 404 on their own status page, and any
 *  score that did land was filed under the default team's experience metric. */
function resolve(token: string) {
  const entryId = getEntryIdByStatusToken(token);
  if (!entryId) return null;
  const workspaceId = getEntryWorkspace(entryId);
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return null;
  // Only a TERMINAL outcome (hired / not selected) gets the question. Asking someone
  // mid-process how the process went would both be premature and read as pressure while
  // their application is still live.
  const asked = isTerminalCandidateStatus(candidateStatusFor(entry.status, entry.stage, roleOf(entry.stage, getPipelineAxis(workspaceId).stages)));
  return { entryId, workspaceId, asked };
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`nps:${clientIpFrom(request.headers)}:${token}`, NPS_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const resolved = resolve(token);
    if (!resolved) return jsonRefusal("STATUS_LINK_INVALID", 404);
    return jsonOk({ asked: resolved.asked, answered: candidateNpsFor(resolved.entryId, resolved.workspaceId) });
  } catch (error) {
    return safeJsonError(error, "api:status:nps", "STATUS_NPS_READ_FAILED");
  }
}

/** Hard cap on this public door's request body: a 0-10 score and a short free-text comment, which the store clamps again.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_NPS_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`nps:${clientIpFrom(request.headers)}:${token}`, NPS_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const resolved = resolve(token);
    if (!resolved) return jsonRefusal("STATUS_LINK_INVALID", 404);
    // Refuse rather than silently store: a response captured mid-process would be folded
    // into a "candidate experience" figure that claims to measure completed journeys.
    if (!resolved.asked) return jsonRefusal("STATUS_NPS_NOT_APPLICABLE", 409);

    const body = await readJsonWithLimit<{ score?: unknown; comment?: unknown }>(request, MAX_NPS_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_NPS_BODY_BYTES });
    const parsed = parseNpsSubmission(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 });

    recordCandidateNps(resolved.entryId, parsed.score, parsed.comment, resolved.workspaceId);
    return jsonOk({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:status:nps", "STATUS_NPS_WRITE_FAILED");
  }
}
