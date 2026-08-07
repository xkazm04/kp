import { NextResponse } from "next/server";
import { candidateOutcomes } from "@/app/_lib/db/pipeline";
import { listJobStatuses } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { filterRelevantAlerts, sweepRediscoveryAlerts } from "@/app/_lib/rediscover";
import {
  dismissRediscoveryAlert,
  listRediscoveryAlerts,
} from "@/app/_lib/rediscovery-alert-store";


// Standing silver-medalist feed (idea-fdb45cd0). GET = the active, still-relevant
// alerts; PATCH {id} dismisses one; POST runs a pool-change sweep over published
// roles and returns the refreshed feed (the "a strong candidate entered the pool"
// trigger, on demand from the feed's Refresh).

// The POST sweep fans out recruiter_cli rankings (now bounded by a worker pool +
// per-role timeout + a roles-per-sweep ceiling in sweepRediscoveryAlerts). Give it
// the same generous provider budget the single-CLI campaign/outreach routes use so
// a legitimately busy sweep isn't killed at the platform's default serverless
// timeout mid-run (bug-ui-scan #2).
export const maxDuration = 180;

// Relevance is filtered at read time against LIVE state — an alert for a role
// since unpublished, or a candidate since pipelined into it, is no longer a
// silver medalist even though its row persists (dismissed state is sticky).
function relevantAlerts(workspaceId: string) {
  const statuses = listJobStatuses(workspaceId);
  // Scope BOTH reads to the session workspace: an unscoped candidateOutcomes/
  // listRediscoveryAlerts defaults to the single tenant, so in any other team the
  // feed would read the default tenant's alerts + pipeline history regardless of who
  // is signed in. The alert store persists per-workspace (recordRediscoveryAlerts),
  // so listRediscoveryAlerts(workspaceId) returns only this team's standing alerts.
  const outcomes = candidateOutcomes(workspaceId);
  return filterRelevantAlerts(
    listRediscoveryAlerts(workspaceId),
    (jobId) => statuses[jobId] === "published",
    (jobId, candidateId) =>
      (outcomes.get(candidateId) ?? []).some((o) => o.jobId === jobId && o.status === "active")
  );
}

export async function GET() {
  try {
    const alerts = relevantAlerts(await currentWorkspace());
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
    // Sweep the CALLER's catalog, not the default tenant's (rediscovery-alerts #1):
    // this POST is the feed's Refresh, fired from one team's session, so the roles
    // swept and the alerts raised must match the feed the same request returns below.
    const ws = await currentWorkspace();
    const { jobsSwept, newAlerts, truncated } = await sweepRediscoveryAlerts({ signal: request.signal, workspaceId: ws });
    const alerts = relevantAlerts(ws);
    return NextResponse.json({ alerts, count: alerts.length, jobsSwept, newAlerts, truncated });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}
