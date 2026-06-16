import { NextResponse } from "next/server";
import { candidateOutcomes } from "@/app/_lib/db";
import { listJobStatuses } from "@/app/_lib/job-ingest";
import { safeJsonError } from "@/app/_lib/api-response";
import { filterRelevantAlerts, sweepRediscoveryAlerts } from "@/app/_lib/rediscover";
import {
  dismissRediscoveryAlert,
  listRediscoveryAlerts,
} from "@/app/_lib/rediscovery-alert-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Standing silver-medalist feed (idea-fdb45cd0). GET = the active, still-relevant
// alerts; PATCH {id} dismisses one; POST runs a pool-change sweep over published
// roles and returns the refreshed feed (the "a strong candidate entered the pool"
// trigger, on demand from the feed's Refresh).

// Relevance is filtered at read time against LIVE state — an alert for a role
// since unpublished, or a candidate since pipelined into it, is no longer a
// silver medalist even though its row persists (dismissed state is sticky).
function relevantAlerts() {
  const statuses = listJobStatuses();
  const outcomes = candidateOutcomes();
  return filterRelevantAlerts(
    listRediscoveryAlerts(),
    (jobId) => statuses[jobId] === "published",
    (jobId, candidateId) =>
      (outcomes.get(candidateId) ?? []).some((o) => o.jobId === jobId && o.status === "active")
  );
}

export async function GET() {
  try {
    const alerts = relevantAlerts();
    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    const dismissed = dismissRediscoveryAlert(id);
    return NextResponse.json({ dismissed });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}

export async function POST(request: Request) {
  try {
    const { jobsSwept, newAlerts } = await sweepRediscoveryAlerts({ signal: request.signal });
    const alerts = relevantAlerts();
    return NextResponse.json({ alerts, count: alerts.length, jobsSwept, newAlerts });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}
