import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { roleOf } from "@/app/_lib/pipeline-stages";
import { candidateStatusFor } from "@/app/_lib/application-status";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// Abuse containment, in the same shape as every other PUBLIC token route (offer,
// schedule, data, invite — all throttled per token AND client). The token is a
// strong CSPRNG capability, so this is not guessing prevention: it caps what a
// single link-holder can extract from the DB per minute.
//
// Deliberately GENEROUS. StatusClient polls every 45s (~1.3 req/min), refetches
// on tab focus/visibility, and offers a manual Refresh — 60/min leaves an order
// of magnitude of headroom, so normal use (and a candidate impatiently mashing
// Refresh) can never meet the limiter. Keyed by token AND client so the untrusted-
// proxy fallback (every caller shares one client key — see resolveClientIp) still
// gives each candidate their own bucket rather than one shared global cap.
const STATUS_RATE_LIMIT = { limit: 60, windowMs: 60_000 };


// Public, token-gated candidate application status (idea-e76a6fb2). Returns a
// candidate-safe projection only — the friendly status, the role title/company,
// and when it last changed. Never the internal entry id, candidate name, score,
// archetype, or reasoning.
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Throttle BEFORE the store reads, so a flood is rejected cheaply.
    if (!rateLimit(`status:${clientIpFrom(request.headers)}:${token}`, STATUS_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const entryId = getEntryIdByStatusToken(token);
    // Coded, never prose: this is a PUBLIC door whose link rides an email written
    // in the candidate's own language (api-contracts.md 1.1).
    if (!entryId) return jsonRefusal("STATUS_LINK_INVALID", 404);
    // Tenant scope from the entry itself (token-driven flow, no session), exactly
    // as the sibling /decisions route does. Without it this read fell through to
    // DEFAULT_WORKSPACE_ID, so a candidate of any other team got a 404 on their
    // own status link.
    const workspaceId = getEntryWorkspace(entryId);
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return jsonRefusal("STATUS_LINK_INVALID", 404);
    const company = entry.jobId ? getJob(entry.jobId)?.company ?? null : null;
    return jsonOk({
      status: candidateStatusFor(entry.status, entry.stage, roleOf(entry.stage, getPipelineAxis(workspaceId).stages)),
      jobTitle: entry.jobTitle ?? null,
      company,
      updatedAt: entry.stageChangedAt ?? entry.createdAt ?? null,
      // REC-10 — gates the page's "watch your email" promises: with no relay
      // configured no email will ever arrive, so the copy says "the team will
      // reach out" instead. Capability only — no secrets on the public wire.
      relayConfigured: isRelayConfigured(),
    });
  } catch (error) {
    // Raw err.message would surface SQLite internals on a public token route.
    return safeJsonError(error, "api:status", "STATUS_LOOKUP_FAILED");
  }
}
