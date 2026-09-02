import { NextResponse } from "next/server";
import { candidateOutcomes } from "@/app/_lib/db/pipeline";
import { listJobStatuses } from "@/app/_lib/job-ingest";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, RATE_LIMITED_ERROR, rateLimit } from "@/app/_lib/rate-limit";
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
      // ANY entry in that role means a recruiter already acted on this alert. Testing
      // `status === "active"` instead meant that adding the candidate and THEN rejecting
      // them flipped the predicate back to false, so the alert RESURFACED — recommending
      // the person for the role they had just been rejected from, still carrying its
      // original "Rejected · <other role>" chip so it read as a fresh suggestion. No
      // over-filtering results: pickPrior now only ever raises an alert for a candidate
      // with no entry in that role, so a later entry can only mean it was acted on.
      (outcomes.get(candidateId) ?? []).some((o) => o.jobId === jobId)
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
    // Dismissal is STICKY (the UNIQUE (job_id, candidate_id) index makes every later
    // sweep an INSERT OR IGNORE no-op) and an alert id is NOT a capability token —
    // listRediscoveryAlerts hands it to every recruiter in the feed. So scope the
    // write to the caller's team; `dismissed: false` answers "not yours", "already
    // dismissed" and "never existed" identically, so it is no existence oracle.
    const dismissed = dismissRediscoveryAlert(id, await currentWorkspace());
    return NextResponse.json({ dismissed });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}

export async function POST(request: Request) {
  try {
    // THROTTLE: this is the heaviest compute surface in the jobs area — one call
    // fans out a `recruiter_cli` child PER published role (bounded by the worker
    // pool, the per-role timeout and the roles-per-sweep ceiling, but still N
    // subprocesses), which is exactly the shape rate-limit.ts exists for: "a route
    // that spends money or spawns a subprocess". It carried no limiter at all.
    // The route is session-gated, but in open mode (no KP_OPERATOR_PASSWORD) that
    // gate is a no-op for the whole API, so a held-open tab clicking Refresh could
    // keep the box saturated with ranking children indefinitely.
    //
    // 10/10min per IP, the same key shape as the other spend routes: a sweep can
    // legitimately run for minutes (maxDuration 180), so ten is far above any human
    // Refresh pace and still bounds the fan-out. BEFORE the sweep, so a refused
    // request has spawned nothing; the GET feed and PATCH dismiss stay unthrottled —
    // they are pure reads/writes and the feed polls them.
    if (!rateLimit(`rediscovery-sweep:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
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
