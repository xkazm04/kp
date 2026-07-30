import { NextRequest, NextResponse } from "next/server";
import { getEntryWorkspace, getPipelineEntry } from "@/app/_lib/db";
import { getEntryIdByStatusToken } from "@/app/_lib/application-status-store";
import { listDecisionRecords } from "@/app/_lib/decision-record-store";
import { candidateDecisionHistory } from "@/app/_lib/status-decisions";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

// EU AI-Act Art. 86 (docs/features/compliance/ai-act-conformity.md) — the candidate's own
// decision history, REDACTED, on their status token. Sibling of the status
// route: the SAME CSPRNG status token is the whole credential (it already
// gates the candidate's status projection; no operator session exists on this
// public surface, and requireOperator would wrongly lock the subject out of
// their own explanation).
//
// Everything sensitive is stripped by candidateDecisionHistory
// (status-decisions.ts): only THIS entry's records (the store query is
// candidateRef-scoped), only allowlisted kinds, only kind/date/attribution/
// reasonCode plus — for auto_rejected — the sealed score-vs-threshold pair.
// Never the rationale (names the approving operator), payload snapshots, chain
// hashes, policy versions, or any other candidate's data. An anonymized or
// consent-expired entry gets an empty list — indistinguishable from "no
// records yet", so the withholding itself leaks nothing.
//
// Fetched once per page view (not polled), so a tighter bound than the status
// route's poll budget still leaves generous headroom.
const STATUS_DECISIONS_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Throttle BEFORE the store reads, keyed per token AND client (sibling pattern).
    if (!rateLimit(`status-decisions:${clientIpFrom(request.headers)}:${token}`, STATUS_DECISIONS_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const entryId = getEntryIdByStatusToken(token);
    if (!entryId) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Tenant scope from the entry itself (token-driven flow, no session): the
    // record read below MUST be scoped to the entry's own workspace chain.
    const workspaceId = getEntryWorkspace(entryId);
    const entry = getPipelineEntry(entryId, workspaceId);
    if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
    const records = candidateDecisionHistory(
      { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt },
      listDecisionRecords({ candidateRef: entryId, workspaceId })
    );
    return jsonOk({ records });
  } catch (error) {
    // Raw err.message would surface SQLite internals on a public token route.
    return safeJsonError(error, "api:status:decisions", "STATUS_DECISIONS_FAILED");
  }
}
